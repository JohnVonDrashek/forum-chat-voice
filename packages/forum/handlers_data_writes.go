package forum

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/forum/oapi"
	"github.com/forumline/forumline/forum/service"
)

// ============================================================================
// Thread writes
// ============================================================================

// CreateThread handles POST /api/threads
func (h *Handlers) CreateThread(ctx context.Context, request oapi.CreateThreadRequestObject) (oapi.CreateThreadResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	var content *string
	if body.Content != nil {
		content = body.Content
	}

	id, err := h.ThreadSvc.Create(ctx, userID, service.CreateThreadInput{
		CategoryID: body.CategoryId,
		Title:      body.Title,
		Slug:       body.Slug,
		Content:    content,
		ImageURL:   body.ImageUrl,
	})
	if err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.CreateThread400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		default:
			return oapi.CreateThread400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}

	idUUID := id
	return oapi.CreateThread201JSONResponse{Id: &idUUID}, nil
}

// UpdateThread handles PATCH /api/threads/{id}
func (h *Handlers) UpdateThread(ctx context.Context, request oapi.UpdateThreadRequestObject) (oapi.UpdateThreadResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	// Convert *time.Time to *string for the service layer
	var lastPostAt *string
	if body.LastPostAt != nil {
		s := body.LastPostAt.Format("2006-01-02T15:04:05Z07:00")
		lastPostAt = &s
	}

	err := h.ThreadSvc.Update(ctx, userID, request.Id, service.UpdateThreadInput{
		ImageURL:   body.ImageUrl,
		LastPostAt: lastPostAt,
		PostCount:  body.PostCount,
		IsPinned:   body.IsPinned,
		IsLocked:   body.IsLocked,
	})
	if err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.UpdateThread400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		case http.StatusForbidden:
			return oapi.UpdateThread403JSONResponse{ForbiddenJSONResponse: oapi.ForbiddenJSONResponse{Error: msg}}, nil
		case http.StatusNotFound:
			return oapi.UpdateThread404JSONResponse{NotFoundJSONResponse: oapi.NotFoundJSONResponse{Error: msg}}, nil
		default:
			return oapi.UpdateThread400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}
	t := true
	return oapi.UpdateThread200JSONResponse(oapi.Success{Success: &t}), nil
}

// ============================================================================
// Post writes
// ============================================================================

// CreatePost handles POST /api/posts
func (h *Handlers) CreatePost(ctx context.Context, request oapi.CreatePostRequestObject) (oapi.CreatePostResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	var replyToID *uuid.UUID
	if body.ReplyToId != nil {
		v := *body.ReplyToId
		replyToID = &v
	}

	id, err := h.PostSvc.Create(ctx, userID, service.CreatePostInput{
		ThreadID:  body.ThreadId,
		Content:   body.Content,
		ReplyToID: replyToID,
	})
	if err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.CreatePost400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		default:
			return oapi.CreatePost400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}

	idUUID := id
	return oapi.CreatePost201JSONResponse{Id: &idUUID}, nil
}

// ============================================================================
// Chat writes
// ============================================================================

// SendChatMessage handles POST /api/channels/{slug}/messages
func (h *Handlers) SendChatMessage(ctx context.Context, request oapi.SendChatMessageRequestObject) (oapi.SendChatMessageResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	if err := h.ChatSvc.SendMessage(ctx, userID, request.Slug, body.Content); err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.SendChatMessage400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		case http.StatusNotFound:
			return oapi.SendChatMessage404JSONResponse{NotFoundJSONResponse: oapi.NotFoundJSONResponse{Error: msg}}, nil
		default:
			return oapi.SendChatMessage400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}
	t := true
	return oapi.SendChatMessage201JSONResponse(oapi.Success{Success: &t}), nil
}

// SendChatMessageByID handles POST /api/channels/_by-id/{id}/messages
func (h *Handlers) SendChatMessageByID(ctx context.Context, request oapi.SendChatMessageByIDRequestObject) (oapi.SendChatMessageByIDResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	if err := h.ChatSvc.SendMessageByID(ctx, userID, request.Id, body.Content); err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.SendChatMessageByID400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		default:
			return oapi.SendChatMessageByID400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}
	t := true
	return oapi.SendChatMessageByID201JSONResponse(oapi.Success{Success: &t}), nil
}

// ============================================================================
// Bookmark writes
// ============================================================================

// AddBookmark handles POST /api/bookmarks
func (h *Handlers) AddBookmark(ctx context.Context, request oapi.AddBookmarkRequestObject) (oapi.AddBookmarkResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.AddBookmark(ctx, userID, request.Body.ThreadId); err != nil {
		return oapi.AddBookmark400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	t := true
	return oapi.AddBookmark201JSONResponse(oapi.Success{Success: &t}), nil
}

// RemoveBookmark handles DELETE /api/bookmarks/{threadId}
func (h *Handlers) RemoveBookmark(ctx context.Context, request oapi.RemoveBookmarkRequestObject) (oapi.RemoveBookmarkResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.RemoveBookmark(ctx, userID, request.ThreadId); err != nil {
		return oapi.RemoveBookmark500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	t := true
	return oapi.RemoveBookmark200JSONResponse(oapi.Success{Success: &t}), nil
}

// RemoveBookmarkById handles DELETE /api/bookmarks/by-id/{id}
func (h *Handlers) RemoveBookmarkById(ctx context.Context, request oapi.RemoveBookmarkByIdRequestObject) (oapi.RemoveBookmarkByIdResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.RemoveBookmarkByID(ctx, userID, request.Id); err != nil {
		return oapi.RemoveBookmarkById500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	t := true
	return oapi.RemoveBookmarkById200JSONResponse(oapi.Success{Success: &t}), nil
}

// ============================================================================
// Notification writes
// ============================================================================

// MarkAllNotificationsRead handles POST /api/notifications/read-all
func (h *Handlers) MarkAllNotificationsRead(ctx context.Context, _ oapi.MarkAllNotificationsReadRequestObject) (oapi.MarkAllNotificationsReadResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.MarkAllNotificationsRead(ctx, userID); err != nil {
		return oapi.MarkAllNotificationsRead500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	t := true
	return oapi.MarkAllNotificationsRead200JSONResponse(oapi.Success{Success: &t}), nil
}

// ============================================================================
// Profile writes
// ============================================================================

// UpsertProfile handles PUT /api/profiles/{id}
func (h *Handlers) UpsertProfile(ctx context.Context, request oapi.UpsertProfileRequestObject) (oapi.UpsertProfileResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	body := request.Body

	err := h.ProfileSvc.Upsert(ctx, userID, request.Id, service.UpdateProfileInput{
		Username:    body.Username,
		DisplayName: body.DisplayName,
		AvatarURL:   body.AvatarUrl,
		Bio:         body.Bio,
		Website:     body.Website,
	})
	if err != nil {
		status, msg := serviceErrStatus(err)
		switch status {
		case http.StatusBadRequest:
			return oapi.UpsertProfile400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		case http.StatusForbidden:
			return oapi.UpsertProfile403JSONResponse{ForbiddenJSONResponse: oapi.ForbiddenJSONResponse{Error: msg}}, nil
		default:
			return oapi.UpsertProfile400JSONResponse{BadRequestJSONResponse: oapi.BadRequestJSONResponse{Error: msg}}, nil
		}
	}
	t := true
	return oapi.UpsertProfile200JSONResponse(oapi.Success{Success: &t}), nil
}

// ClearForumlineId handles DELETE /api/profiles/{id}/forumline-id
func (h *Handlers) ClearForumlineId(ctx context.Context, request oapi.ClearForumlineIdRequestObject) (oapi.ClearForumlineIdResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.ProfileSvc.ClearForumlineID(ctx, userID, request.Id); err != nil {
		status, msg := serviceErrStatus(err)
		if status == http.StatusForbidden {
			return oapi.ClearForumlineId403JSONResponse{ForbiddenJSONResponse: oapi.ForbiddenJSONResponse{Error: msg}}, nil
		}
		return oapi.ClearForumlineId403JSONResponse{ForbiddenJSONResponse: oapi.ForbiddenJSONResponse{Error: msg}}, nil
	}
	t := true
	return oapi.ClearForumlineId200JSONResponse(oapi.Success{Success: &t}), nil
}

// ============================================================================
// Voice presence writes
// ============================================================================

// SetVoicePresence handles PUT /api/voice-presence
func (h *Handlers) SetVoicePresence(ctx context.Context, request oapi.SetVoicePresenceRequestObject) (oapi.SetVoicePresenceResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.SetVoicePresence(ctx, userID, request.Body.RoomSlug); err != nil {
		return oapi.SetVoicePresence500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	h.publishVoiceEvent("INSERT", userID, request.Body.RoomSlug, time.Now())

	t := true
	return oapi.SetVoicePresence200JSONResponse(oapi.Success{Success: &t}), nil
}

// ClearVoicePresence handles DELETE /api/voice-presence
func (h *Handlers) ClearVoicePresence(ctx context.Context, _ oapi.ClearVoicePresenceRequestObject) (oapi.ClearVoicePresenceResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	roomSlug, err := h.Store.ClearVoicePresence(ctx, userID)
	if err != nil {
		return oapi.ClearVoicePresence500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	h.publishVoiceEvent("DELETE", userID, roomSlug, time.Time{})

	t := true
	return oapi.ClearVoicePresence200JSONResponse(oapi.Success{Success: &t}), nil
}

func (h *Handlers) publishVoiceEvent(event string, userID uuid.UUID, roomSlug string, joinedAt time.Time) {
	if h.Config.EventBus == nil {
		return
	}
	data := map[string]interface{}{
		"schema":    h.Config.Schema,
		"event":     event,
		"user_id":   userID,
		"room_slug": roomSlug,
	}
	if event != "DELETE" {
		data["joined_at"] = joinedAt
	}
	payload, _ := json.Marshal(data)
	if err := h.Config.EventBus.Publish(context.Background(), "voice_presence_changes", payload); err != nil {
		log.Printf("[voice] EventBus publish error: %v", err)
	}
}
