package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
)

// httpRequestKey is used to store the *http.Request in the context so StrictServer
// methods can access headers (Authorization for service-key endpoints, etc.).
type httpRequestKey struct{}

// withHTTPRequest injects the *http.Request into the context for every request.
func withHTTPRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), httpRequestKey{}, r)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func httpRequestFromContext(ctx context.Context) *http.Request {
	r, _ := ctx.Value(httpRequestKey{}).(*http.Request)
	return r
}

// strictErrorHandler maps service-layer typed errors to appropriate HTTP status codes.
// It is used as the ResponseErrorHandlerFunc for the strict handler.
func strictErrorHandler(w http.ResponseWriter, _ *http.Request, err error) {
	var valErr *service.ValidationError
	var notFoundErr *service.NotFoundError
	var conflictErr *service.ConflictError
	var forbiddenErr *service.ForbiddenError

	status := http.StatusInternalServerError
	msg := "internal server error"
	switch {
	case errors.As(err, &valErr):
		status, msg = http.StatusBadRequest, valErr.Msg
	case errors.As(err, &notFoundErr):
		status, msg = http.StatusNotFound, notFoundErr.Msg
	case errors.As(err, &conflictErr):
		status, msg = http.StatusConflict, conflictErr.Msg
	case errors.As(err, &forbiddenErr):
		status, msg = http.StatusForbidden, forbiddenErr.Msg
	default:
		log.Printf("[api] unhandled error: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(oapi.ErrorResponse{Error: msg})
}

// jsonConvert converts any value to T via JSON marshal/unmarshal.
// Only used for map[string]interface{} results from dynamic-SQL store methods
// (ListForums, ListOwnedForums, etc.) that can't return typed structs.
func jsonConvert[T any](src any) (T, error) {
	b, err := json.Marshal(src)
	if err != nil {
		var zero T
		return zero, fmt.Errorf("jsonConvert marshal: %w", err)
	}
	var dst T
	if err := json.Unmarshal(b, &dst); err != nil {
		return dst, fmt.Errorf("jsonConvert unmarshal to %T: %w", dst, err)
	}
	return dst, nil
}

// checkServiceKey validates the service key from the request's Authorization header.
func checkServiceKey(r *http.Request) bool {
	if r == nil {
		return false
	}
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return false
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("ZITADEL_SERVICE_USER_PAT")
	return serviceKey != "" && token == serviceKey
}

// StrictServer implements oapi.StrictServerInterface using the existing service and store layers.
type StrictServer struct {
	store    *store.Store
	convoSvc *service.ConversationService
	forumSvc *service.ForumService
	callSvc  *service.CallService
	pushSvc  *service.PushService
	lkCfg    *lkConfig
	dmRL     *httpkit.ValkeyRateLimiter
	sseHub   *sse.Hub
	tracker  *presence.Tracker
	eventBus pubsub.EventBus
}

// lkConfig holds LiveKit connection details (mirrors handler.LiveKitConfig).
type lkConfig struct {
	URL       string
	APIKey    string
	APISecret string
}

// --- Health ---

func (s *StrictServer) GetHealth(_ context.Context, _ oapi.GetHealthRequestObject) (oapi.GetHealthResponseObject, error) {
	return oapi.GetHealth200JSONResponse{Status: "ok"}, nil
}

// --- Auth ---

func (s *StrictServer) GetSession(ctx context.Context, _ oapi.GetSessionRequestObject) (oapi.GetSessionResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if userID == "" {
		return oapi.GetSession401JSONResponse{Error: "not authenticated"}, nil
	}
	return oapi.GetSession200JSONResponse{User: struct {
		Id string "json:\"id\""
	}{Id: userID}}, nil
}

func (s *StrictServer) Logout(_ context.Context, _ oapi.LogoutRequestObject) (oapi.LogoutResponseObject, error) {
	return oapi.Logout200JSONResponse{Ok: "true"}, nil
}

// --- Identity ---

func (s *StrictServer) GetIdentity(ctx context.Context, _ oapi.GetIdentityRequestObject) (oapi.GetIdentityResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	p, err := s.store.GetProfile(ctx, userID)
	if err != nil && p == nil {
		return nil, fmt.Errorf("failed to fetch profile: %w", err)
	}
	if p == nil {
		// Auto-provision: fetch from Zitadel and create profile.
		r := httpRequestFromContext(ctx)
		var authHeader string
		if r != nil {
			authHeader = r.Header.Get("Authorization")
		}
		p, err = provisionProfileFromZitadel(ctx, s.store, userID, authHeader)
		if err != nil {
			log.Printf("[Identity] auto-provision failed for %s: %v", userID, err)
			return nil, fmt.Errorf("failed to create profile: %w", err)
		}
	}
	avatarURL := ""
	if p.AvatarURL != nil {
		avatarURL = *p.AvatarURL
	}
	resp := oapi.GetIdentity200JSONResponse{
		ForumlineId:      userID,
		Username:         p.Username,
		DisplayName:      p.DisplayName,
		AvatarUrl:        avatarURL,
		StatusMessage:    p.StatusMessage,
		OnlineStatus:     oapi.ProfileOnlineStatus(p.OnlineStatus),
		ShowOnlineStatus: p.ShowOnlineStatus,
	}
	if p.Bio != nil && *p.Bio != "" {
		resp.Bio = p.Bio
	}
	return resp, nil
}

func (s *StrictServer) UpdateIdentity(ctx context.Context, req oapi.UpdateIdentityRequestObject) (oapi.UpdateIdentityResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	b := req.Body
	if b == nil {
		return oapi.UpdateIdentity200JSONResponse{Status: "ok"}, nil
	}

	sets := make(map[string]interface{})
	if b.DisplayName != nil {
		name := strings.TrimSpace(*b.DisplayName)
		if name == "" || len([]rune(name)) > 50 {
			return nil, &service.ValidationError{Msg: "display name must be 1-50 characters"}
		}
		sets["display_name"] = name
	}
	if b.StatusMessage != nil {
		msg := strings.TrimSpace(*b.StatusMessage)
		if len([]rune(msg)) > 100 {
			return nil, &service.ValidationError{Msg: "status message must be 100 characters or fewer"}
		}
		sets["status_message"] = msg
	}
	if b.OnlineStatus != nil {
		switch *b.OnlineStatus {
		case "online", "away", "offline":
		default:
			return nil, &service.ValidationError{Msg: "online_status must be online, away, or offline"}
		}
		sets["online_status"] = string(*b.OnlineStatus)
	}
	if b.ShowOnlineStatus != nil {
		sets["show_online_status"] = *b.ShowOnlineStatus
	}
	if len(sets) > 0 {
		if err := s.store.UpdateProfile(ctx, userID, sets); err != nil {
			return nil, fmt.Errorf("failed to update profile: %w", err)
		}
	}
	return oapi.UpdateIdentity200JSONResponse{Status: "ok"}, nil
}

func (s *StrictServer) DeleteIdentity(ctx context.Context, _ oapi.DeleteIdentityRequestObject) (oapi.DeleteIdentityResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if err := s.store.DeleteUser(ctx, userID); err != nil {
		return nil, fmt.Errorf("failed to delete account: %w", err)
	}
	z, err := service.GetZitadelClient(ctx)
	if err == nil {
		if err := z.DeleteUser(ctx, userID); err != nil {
			log.Printf("[Identity] warning: failed to delete Zitadel user %s: %v", userID, err)
		}
	}
	return oapi.DeleteIdentity200JSONResponse{Status: "deleted"}, nil
}

func (s *StrictServer) SearchProfiles(ctx context.Context, req oapi.SearchProfilesRequestObject) (oapi.SearchProfilesResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	q := strings.TrimSpace(req.Params.Q)
	if q == "" {
		return nil, &service.ValidationError{Msg: "q parameter is required"}
	}
	profiles, err := s.store.SearchProfiles(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to search profiles: %w", err)
	}
	return oapi.SearchProfiles200JSONResponse(profiles), nil
}

// --- Conversations ---

func (s *StrictServer) ListConversations(ctx context.Context, _ oapi.ListConversationsRequestObject) (oapi.ListConversationsResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	convos, err := s.store.ListConversations(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversations: %w", err)
	}
	return oapi.ListConversations200JSONResponse(convos), nil
}

func (s *StrictServer) GetConversation(ctx context.Context, req oapi.GetConversationRequestObject) (oapi.GetConversationResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	c, err := s.store.GetConversation(ctx, userID, uuid.UUID(req.ConversationId))
	if err != nil || c == nil {
		return oapi.GetConversation404JSONResponse{Error: "conversation not found"}, nil
	}
	return oapi.GetConversation200JSONResponse(*c), nil
}

func (s *StrictServer) GetOrCreateDM(ctx context.Context, req oapi.GetOrCreateDMRequestObject) (oapi.GetOrCreateDMResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	convoID, err := s.convoSvc.GetOrCreateDM(ctx, userID, req.Body.UserId)
	if err != nil {
		return nil, err
	}
	return oapi.GetOrCreateDM200JSONResponse{Id: convoID}, nil
}

func (s *StrictServer) CreateGroupConversation(ctx context.Context, req oapi.CreateGroupConversationRequestObject) (oapi.CreateGroupConversationResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	input := service.CreateGroupInput{MemberIDs: req.Body.MemberIds}
	if req.Body.Name != nil {
		input.Name = *req.Body.Name
	}
	convo, err := s.convoSvc.CreateGroup(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	convo.LastMessageTime = time.Now().Format(time.RFC3339)
	return oapi.CreateGroupConversation201JSONResponse(*convo), nil
}

func (s *StrictServer) UpdateConversation(ctx context.Context, req oapi.UpdateConversationRequestObject) (oapi.UpdateConversationResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return oapi.UpdateConversation200JSONResponse{Success: true}, nil
	}
	input := service.UpdateInput{Name: req.Body.Name}
	if req.Body.AddMembers != nil {
		input.AddMembers = *req.Body.AddMembers
	}
	if req.Body.RemoveMembers != nil {
		input.RemoveMembers = *req.Body.RemoveMembers
	}
	if err := s.convoSvc.Update(ctx, userID, uuid.UUID(req.ConversationId), input); err != nil {
		return nil, err
	}
	return oapi.UpdateConversation200JSONResponse{Success: true}, nil
}

func (s *StrictServer) LeaveConversation(ctx context.Context, req oapi.LeaveConversationRequestObject) (oapi.LeaveConversationResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if err := s.convoSvc.Leave(ctx, userID, uuid.UUID(req.ConversationId)); err != nil {
		return nil, err
	}
	return oapi.LeaveConversation200JSONResponse{Success: true}, nil
}

func (s *StrictServer) GetMessages(ctx context.Context, req oapi.GetMessagesRequestObject) (oapi.GetMessagesResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	var before, limit string
	if req.Params.Before != nil {
		before = *req.Params.Before
	}
	if req.Params.Limit != nil {
		limit = fmt.Sprintf("%d", *req.Params.Limit)
	}
	msgs, err := s.convoSvc.GetMessages(ctx, userID, uuid.UUID(req.ConversationId), before, limit)
	if err != nil {
		return nil, err
	}
	return oapi.GetMessages200JSONResponse(msgs), nil
}

func (s *StrictServer) SendMessage(ctx context.Context, req oapi.SendMessageRequestObject) (oapi.SendMessageResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if s.dmRL != nil && !s.dmRL.Allow(userID) {
		return nil, &service.ValidationError{Msg: "rate limit exceeded"}
	}
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	msg, err := s.convoSvc.SendMessage(ctx, userID, uuid.UUID(req.ConversationId), req.Body.Content)
	if err != nil {
		return nil, err
	}
	return oapi.SendMessage201JSONResponse(*msg), nil
}

func (s *StrictServer) MarkConversationRead(ctx context.Context, req oapi.MarkConversationReadRequestObject) (oapi.MarkConversationReadResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if err := s.store.MarkRead(ctx, uuid.UUID(req.ConversationId), userID); err != nil {
		return nil, fmt.Errorf("failed to mark as read: %w", err)
	}
	return oapi.MarkConversationRead200JSONResponse{Success: true}, nil
}

// --- Forums ---

func (s *StrictServer) ListForums(ctx context.Context, req oapi.ListForumsRequestObject) (oapi.ListForumsResponseObject, error) {
	p := req.Params
	search := ""
	if p.Q != nil {
		search = strings.TrimSpace(*p.Q)
	}
	tag := ""
	if p.Tag != nil {
		tag = strings.TrimSpace(*p.Tag)
	}
	sortOrder := "popular"
	if p.Sort != nil {
		sortOrder = *p.Sort
	}
	limit := 50
	if p.Limit != nil && *p.Limit > 0 && *p.Limit <= 100 {
		limit = *p.Limit
	}
	offset := 0
	if p.Offset != nil && *p.Offset >= 0 {
		offset = *p.Offset
	}

	forums, err := s.store.ListForums(ctx, search, tag, sortOrder, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list forums: %w", err)
	}
	result, err := jsonConvert[oapi.ListForums200JSONResponse](forums)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *StrictServer) ListForumTags(ctx context.Context, _ oapi.ListForumTagsRequestObject) (oapi.ListForumTagsResponseObject, error) {
	tags, err := s.store.ListForumTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %w", err)
	}
	return oapi.ListForumTags200JSONResponse(tags), nil
}

func (s *StrictServer) GetRecommendedForums(ctx context.Context, _ oapi.GetRecommendedForumsRequestObject) (oapi.GetRecommendedForumsResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	forums, err := s.store.ListRecommendedForums(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch recommendations: %w", err)
	}
	result, err := jsonConvert[oapi.GetRecommendedForums200JSONResponse](forums)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *StrictServer) GetOwnedForums(ctx context.Context, _ oapi.GetOwnedForumsRequestObject) (oapi.GetOwnedForumsResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	forums, err := s.store.ListOwnedForums(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list owned forums: %w", err)
	}
	result, err := jsonConvert[oapi.GetOwnedForums200JSONResponse](forums)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *StrictServer) RegisterForum(ctx context.Context, req oapi.RegisterForumRequestObject) (oapi.RegisterForumResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	b := req.Body
	result, err := s.forumSvc.RegisterForum(ctx, userID, service.RegisterForumInput{
		Domain:       b.Domain,
		Name:         b.Name,
		APIBase:      b.ApiBase,
		WebBase:      b.WebBase,
		Capabilities: b.Capabilities,
		Description:  b.Description,
		Tags:         derefStrSlice(b.Tags),
	})
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(b.Domain, ".forumline.net") {
		slug := strings.TrimSuffix(b.Domain, ".forumline.net")
		desc := ""
		if b.Description != nil {
			desc = *b.Description
		}
		r := httpRequestFromContext(ctx)
		var authHeader string
		if r != nil {
			authHeader = r.Header.Get("Authorization")
		}
		if err := provisionHostedForum(ctx, authHeader, userID, slug, b.Name, desc); err != nil {
			log.Printf("[Forums] hosted provisioning failed for %s: %v", b.Domain, err)
		}
	}
	return oapi.RegisterForum200JSONResponse{
		ForumId:  result.ForumID.String(),
		Approved: result.Approved,
		Message:  result.Message,
	}, nil
}

func (s *StrictServer) DeleteForum(ctx context.Context, req oapi.DeleteForumRequestObject) (oapi.DeleteForumResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	forumDomain := req.Body.ForumDomain
	forumID := s.store.GetForumIDByDomain(ctx, forumDomain)
	if forumID == uuid.Nil {
		return nil, &service.NotFoundError{Msg: "forum not found"}
	}
	ownerID, _ := s.store.GetForumOwner(ctx, forumID)
	if ownerID == nil || *ownerID != userID {
		return nil, &service.ForbiddenError{Msg: "you are not the owner of this forum"}
	}
	memberCount := s.store.CountForumMembers(ctx, forumID)
	rows, err := s.store.DeleteForum(ctx, forumID, userID)
	if err != nil || rows == 0 {
		return nil, fmt.Errorf("forum not found or not owned by you")
	}
	log.Printf("[Forums] deleted domain=%s id=%s owner=%s members_removed=%d", forumDomain, forumID, userID, memberCount)
	return oapi.DeleteForum200JSONResponse{Ok: true, MembersRemoved: memberCount}, nil
}

// --- Memberships ---

func (s *StrictServer) GetMemberships(ctx context.Context, _ oapi.GetMembershipsRequestObject) (oapi.GetMembershipsResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	memberships, err := s.store.ListMemberships(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch memberships: %w", err)
	}
	return oapi.GetMemberships200JSONResponse(memberships), nil
}

func (s *StrictServer) UpdateMembershipAuth(ctx context.Context, req oapi.UpdateMembershipAuthRequestObject) (oapi.UpdateMembershipAuthResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	forumID := s.store.GetForumIDByDomain(ctx, req.Body.ForumDomain)
	if forumID == uuid.Nil {
		return nil, &service.NotFoundError{Msg: "forum not found"}
	}
	if err := s.store.UpdateMembershipAuth(ctx, userID, forumID, req.Body.Authed); err != nil {
		return nil, fmt.Errorf("failed to update auth state: %w", err)
	}
	return oapi.UpdateMembershipAuth200JSONResponse{Ok: true}, nil
}

func (s *StrictServer) ToggleMembershipMute(ctx context.Context, req oapi.ToggleMembershipMuteRequestObject) (oapi.ToggleMembershipMuteResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	forumID := s.store.GetForumIDByDomain(ctx, req.Body.ForumDomain)
	if forumID == uuid.Nil {
		return nil, &service.NotFoundError{Msg: "forum not found"}
	}
	if err := s.store.UpdateMembershipMute(ctx, userID, forumID, req.Body.Muted); err != nil {
		return nil, fmt.Errorf("failed to update mute state: %w", err)
	}
	return oapi.ToggleMembershipMute200JSONResponse{Ok: true}, nil
}

func (s *StrictServer) JoinForum(ctx context.Context, req oapi.JoinForumRequestObject) (oapi.JoinForumResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	forumID, err := s.forumSvc.ResolveOrDiscoverForum(ctx, req.Body.ForumDomain)
	if err != nil {
		return nil, &service.NotFoundError{Msg: "forum not found and manifest fetch failed"}
	}
	if err := s.store.UpsertMembership(ctx, userID, forumID); err != nil {
		return nil, fmt.Errorf("failed to join forum: %w", err)
	}
	details, err := s.store.GetMembershipJoinDetails(ctx, forumID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch forum details: %w", err)
	}
	result, err := jsonConvert[oapi.JoinForum200JSONResponse](details)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *StrictServer) LeaveForum(ctx context.Context, req oapi.LeaveForumRequestObject) (oapi.LeaveForumResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	forumID := s.store.GetForumIDByDomain(ctx, req.Body.ForumDomain)
	if forumID == uuid.Nil {
		return nil, &service.NotFoundError{Msg: "forum not found"}
	}
	if err := s.store.DeleteMembership(ctx, userID, forumID); err != nil {
		return nil, fmt.Errorf("failed to leave forum: %w", err)
	}
	return oapi.LeaveForum200JSONResponse{Ok: true}, nil
}

// --- Notifications ---

func (s *StrictServer) GetNotifications(ctx context.Context, _ oapi.GetNotificationsRequestObject) (oapi.GetNotificationsResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	notifs, err := s.store.ListNotifications(ctx, userID, 50)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch notifications: %w", err)
	}
	items := make(oapi.GetNotifications200JSONResponse, len(notifs))
	for i, n := range notifs {
		items[i] = oapi.Notification{
			Id:          n.ID.String(),
			Type:        oapi.NotificationType(n.Type),
			Title:       n.Title,
			Body:        n.Body,
			Link:        n.Link,
			Read:        n.Read,
			Timestamp:   n.CreatedAt,
			ForumDomain: n.ForumDomain,
			ForumName:   n.ForumName,
		}
	}
	return items, nil
}

func (s *StrictServer) GetUnreadCount(ctx context.Context, _ oapi.GetUnreadCountRequestObject) (oapi.GetUnreadCountResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	count, err := s.store.CountUnreadNotifications(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to count unread: %w", err)
	}
	return oapi.GetUnreadCount200JSONResponse{Count: count}, nil
}

func (s *StrictServer) MarkNotificationRead(ctx context.Context, req oapi.MarkNotificationReadRequestObject) (oapi.MarkNotificationReadResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	notifID, err := uuid.Parse(req.Body.Id)
	if err != nil {
		return nil, &service.ValidationError{Msg: "invalid notification id"}
	}
	if err := s.store.MarkNotificationRead(ctx, notifID, userID); err != nil {
		return nil, fmt.Errorf("failed to mark read: %w", err)
	}
	return oapi.MarkNotificationRead200JSONResponse{Success: true}, nil
}

func (s *StrictServer) MarkAllNotificationsRead(ctx context.Context, _ oapi.MarkAllNotificationsReadRequestObject) (oapi.MarkAllNotificationsReadResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if err := s.store.MarkAllNotificationsRead(ctx, userID); err != nil {
		return nil, fmt.Errorf("failed to mark all read: %w", err)
	}
	return oapi.MarkAllNotificationsRead200JSONResponse{Success: true}, nil
}

// --- Activity ---

func (s *StrictServer) GetActivity(ctx context.Context, _ oapi.GetActivityRequestObject) (oapi.GetActivityResponseObject, error) {
	// Delegate to the existing activity handler logic directly.
	// The activity handler fetches threads from forums concurrently; we reuse that code
	// by calling the store layer it depends on.
	userID := auth.UserIDFromContext(ctx)
	memberships, err := s.store.ListMemberships(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch memberships: %w", err)
	}
	if len(memberships) == 0 {
		return oapi.GetActivity200JSONResponse{}, nil
	}
	// Reuse the activity handler's logic via the existing handler (avoids duplicating the concurrent fetch).
	// We create a temporary handler and call its logic through an inline recorder.
	items, err := fetchActivityItems(ctx, memberships)
	if err != nil {
		return nil, err
	}
	result, err := jsonConvert[oapi.GetActivity200JSONResponse](items)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// --- Presence ---

func (s *StrictServer) PresenceHeartbeat(ctx context.Context, _ oapi.PresenceHeartbeatRequestObject) (oapi.PresenceHeartbeatResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	s.tracker.Touch(userID)
	return oapi.PresenceHeartbeat200JSONResponse{Ok: true}, nil
}

func (s *StrictServer) GetPresenceStatus(ctx context.Context, req oapi.GetPresenceStatusRequestObject) (oapi.GetPresenceStatusResponseObject, error) {
	idsParam := req.Params.UserIds
	if idsParam == "" {
		return oapi.GetPresenceStatus200JSONResponse{}, nil
	}
	userIDs := strings.Split(idsParam, ",")
	if len(userIDs) > 200 {
		userIDs = userIDs[:200]
	}
	status := s.tracker.OnlineStatusBatch(userIDs)
	prefs, err := s.store.GetOnlineStatusPreferences(ctx, userIDs)
	if err == nil {
		for uid, showOnline := range prefs {
			if !showOnline {
				status[uid] = false
			}
		}
	}
	return oapi.GetPresenceStatus200JSONResponse(status), nil
}

// --- Calls ---

func (s *StrictServer) InitiateCall(ctx context.Context, req oapi.InitiateCallRequestObject) (oapi.InitiateCallResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	result, err := s.callSvc.Initiate(ctx, userID, uuid.UUID(req.Body.ConversationId))
	if err != nil {
		return nil, err
	}
	return oapi.InitiateCall201JSONResponse(*result.Call), nil
}

func (s *StrictServer) RespondToCall(ctx context.Context, req oapi.RespondToCallRequestObject) (oapi.RespondToCallResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	result, err := s.callSvc.Respond(ctx, userID, uuid.UUID(req.CallId), string(req.Body.Action))
	if err != nil {
		return nil, err
	}
	return oapi.RespondToCall200JSONResponse{Status: result.Status}, nil
}

func (s *StrictServer) EndCall(ctx context.Context, req oapi.EndCallRequestObject) (oapi.EndCallResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	result, err := s.callSvc.End(ctx, userID, uuid.UUID(req.CallId))
	if err != nil {
		return nil, err
	}
	return oapi.EndCall200JSONResponse{Status: result.Status}, nil
}

func (s *StrictServer) GetCallToken(ctx context.Context, req oapi.GetCallTokenRequestObject) (oapi.GetCallTokenResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	lk := s.lkCfg
	if lk == nil || lk.APIKey == "" || lk.APISecret == "" || lk.URL == "" {
		return nil, fmt.Errorf("LiveKit not configured")
	}
	ok, _ := s.store.IsCallParticipant(ctx, uuid.UUID(req.CallId), userID)
	if !ok {
		return nil, &service.ForbiddenError{Msg: "not a participant of this call"}
	}
	token, err := generateLiveKitToken(lk.APIKey, lk.APISecret, req.CallId.String(), userID, s.store, ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}
	return oapi.GetCallToken200JSONResponse{Token: token, Url: lk.URL}, nil
}

// --- Push ---

// ManagePushSubscription handles subscribe/unsubscribe push notification subscriptions.
// The push-notify action (service key auth) is handled by the direct pushH.HandleNotify registration in router.go.
func (s *StrictServer) ManagePushSubscription(ctx context.Context, req oapi.ManagePushSubscriptionRequestObject) (oapi.ManagePushSubscriptionResponseObject, error) {
	userID := auth.UserIDFromContext(ctx)
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	b := req.Body
	if b.Endpoint == "" {
		return nil, &service.ValidationError{Msg: "endpoint is required"}
	}

	if string(req.Params.Action) == "subscribe" {
		if b.Keys == nil || b.Keys.P256dh == nil || b.Keys.Auth == nil {
			return nil, &service.ValidationError{Msg: "keys.p256dh and keys.auth are required for subscribe"}
		}
		if err := s.store.UpsertPushSubscription(ctx, userID, b.Endpoint, *b.Keys.P256dh, *b.Keys.Auth); err != nil {
			return nil, fmt.Errorf("failed to save subscription: %w", err)
		}
		return oapi.ManagePushSubscription200JSONResponse{Ok: true}, nil
	}

	// unsubscribe
	_ = s.store.DeletePushSubscription(ctx, userID, b.Endpoint)
	return oapi.ManagePushSubscription200JSONResponse{Ok: true}, nil
}

// --- Webhooks ---

func (s *StrictServer) WebhookNotification(ctx context.Context, req oapi.WebhookNotificationRequestObject) (oapi.WebhookNotificationResponseObject, error) {
	r := httpRequestFromContext(ctx)
	if !checkServiceKey(r) {
		return nil, &service.ForbiddenError{Msg: "invalid authorization"}
	}
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	b := req.Body
	forumName := b.ForumDomain
	if name, err := s.store.GetForumNameByDomain(ctx, b.ForumDomain); err == nil {
		forumName = name
	}
	link := b.Link
	if link == "" {
		link = "/"
	}
	id, createdAt, err := s.store.InsertNotification(ctx, b.ForumlineUserId, b.ForumDomain, forumName, string(b.Type), b.Title, b.Body, link)
	if err != nil {
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}
	if s.eventBus != nil {
		payload, _ := json.Marshal(map[string]interface{}{
			"id": id, "user_id": b.ForumlineUserId,
			"forum_domain": b.ForumDomain, "forum_name": forumName,
			"type": string(b.Type), "title": b.Title, "body": b.Body,
			"link": link, "read": false, "created_at": createdAt,
		})
		_ = s.eventBus.Publish(ctx, "forumline_notification_changes", payload)
	}
	return oapi.WebhookNotification200JSONResponse{Status: "ok"}, nil
}

func (s *StrictServer) WebhookNotificationBatch(ctx context.Context, req oapi.WebhookNotificationBatchRequestObject) (oapi.WebhookNotificationBatchResponseObject, error) {
	r := httpRequestFromContext(ctx)
	if !checkServiceKey(r) {
		return nil, &service.ForbiddenError{Msg: "invalid authorization"}
	}
	if req.Body == nil {
		return nil, &service.ValidationError{Msg: "request body required"}
	}
	b := req.Body
	forumName := b.ForumName
	if forumName == "" {
		if name, err := s.store.GetForumNameByDomain(ctx, b.ForumDomain); err == nil {
			forumName = name
		} else {
			forumName = b.ForumDomain
		}
	}
	inserted := 0
	for _, item := range b.Items {
		if item.ForumlineUserId == "" || item.Type == "" || item.Title == "" {
			continue
		}
		link := item.Link
		if link == "" {
			link = "/"
		}
		id, createdAt, err := s.store.InsertNotification(ctx, item.ForumlineUserId, b.ForumDomain, forumName, string(item.Type), item.Title, item.Body, link)
		if err != nil {
			log.Printf("[webhook] batch insert error: %v", err)
			continue
		}
		if s.eventBus != nil {
			payload, _ := json.Marshal(map[string]interface{}{
				"id": id, "user_id": item.ForumlineUserId,
				"forum_domain": b.ForumDomain, "forum_name": forumName,
				"type": string(item.Type), "title": item.Title, "body": item.Body,
				"link": link, "read": false, "created_at": createdAt,
			})
			_ = s.eventBus.Publish(ctx, "forumline_notification_changes", payload)
		}
		inserted++
	}
	return oapi.WebhookNotificationBatch200JSONResponse{Inserted: inserted}, nil
}

// --- SSE (direct handler — see router.go) ---

// GetEventStream satisfies StrictServerInterface. The actual SSE endpoint is registered
// directly in router.go to support proper HTTP flushing; this code path is unreachable.
func (s *StrictServer) GetEventStream(_ context.Context, _ oapi.GetEventStreamRequestObject) (oapi.GetEventStreamResponseObject, error) {
	panic("unreachable: SSE endpoint is handled by direct registration in router.go")
}
