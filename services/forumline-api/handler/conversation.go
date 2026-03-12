package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type ConversationHandler struct {
	Store  *store.Store
	SSEHub *shared.SSEHub
}

func NewConversationHandler(s *store.Store, hub *shared.SSEHub) *ConversationHandler {
	return &ConversationHandler{Store: s, SSEHub: hub}
}

func (h *ConversationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convos, err := h.Store.ListConversations(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch conversations"})
		return
	}
	writeJSON(w, http.StatusOK, convos)
}

func (h *ConversationHandler) HandleGet(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	c, err := h.Store.GetConversation(r.Context(), userID, convoID)
	if err != nil || c == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *ConversationHandler) HandleGetOrCreateDM(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()
	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
		return
	}
	if body.UserID == userID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot message yourself"})
		return
	}
	exists, err := h.Store.ProfileExists(ctx, body.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to verify user"})
		return
	}
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}
	convoID, err := h.Store.FindOrCreate1to1Conversation(ctx, userID, body.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create conversation"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": convoID})
}

func (h *ConversationHandler) HandleCreateGroup(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()
	var body struct {
		MemberIDs []string `json:"memberIds"`
		Name      string   `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if len(body.MemberIDs) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group must have at least 2 other members"})
		return
	}
	if len(body.MemberIDs) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group cannot exceed 50 members"})
		return
	}
	name := trimString(body.Name)
	if name == "" || len(name) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group name must be 1-100 characters"})
		return
	}

	allMembers := append([]string{userID}, body.MemberIDs...)
	seen := make(map[string]bool)
	var unique []string
	for _, id := range allMembers {
		if !seen[id] && id != "" {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) < 3 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group must have at least 3 members including yourself"})
		return
	}
	count, _ := h.Store.CountExistingUsers(ctx, unique)
	if count != len(unique) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "One or more users not found"})
		return
	}

	convoID, err := h.Store.CreateGroupConversation(ctx, name, userID, unique)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create group"})
		return
	}

	profiles, _ := h.Store.FetchProfilesByIDs(ctx, unique)
	members := make([]model.ConversationMember, 0, len(unique))
	for _, id := range unique {
		m := model.ConversationMember{ID: id}
		if p := profiles[id]; p != nil {
			m.Username = p.Username
			m.DisplayName = p.DisplayName
			if m.DisplayName == "" {
				m.DisplayName = p.Username
			}
			m.AvatarURL = p.AvatarURL
		}
		members = append(members, m)
	}

	writeJSON(w, http.StatusCreated, model.Conversation{
		ID: convoID, IsGroup: true, Name: &name, Members: members,
		LastMessageTime: time.Now().Format(time.RFC3339),
	})
}

func (h *ConversationHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	ctx := r.Context()

	isGroup, err := h.Store.IsGroupConversation(ctx, convoID, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if !isGroup {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot modify a 1:1 conversation"})
		return
	}

	var body struct {
		Name          *string  `json:"name"`
		AddMembers    []string `json:"addMembers"`
		RemoveMembers []string `json:"removeMembers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.Name != nil {
		name := trimString(*body.Name)
		if name == "" || len(name) > 100 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group name must be 1-100 characters"})
			return
		}
		_ = h.Store.UpdateConversationName(ctx, convoID, name)
	}
	if len(body.AddMembers) > 0 {
		_ = h.Store.AddConversationMembers(ctx, convoID, body.AddMembers)
	}
	if len(body.RemoveMembers) > 0 {
		var filtered []string
		for _, id := range body.RemoveMembers {
			if id != userID {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) > 0 {
			_ = h.Store.RemoveConversationMembers(ctx, convoID, filtered)
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleGetMessages(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	ctx := r.Context()

	isMember, _ := h.Store.IsConversationMember(ctx, convoID, userID)
	if !isMember {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	msgs, err := h.Store.GetMessages(ctx, convoID, r.URL.Query().Get("before"), r.URL.Query().Get("limit"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch messages"})
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *ConversationHandler) HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	ctx := r.Context()

	isMember, _ := h.Store.IsConversationMember(ctx, convoID, userID)
	if !isMember {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	content := trimString(body.Content)
	if content == "" || len(content) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Message must be 1-2000 characters"})
		return
	}

	msg, err := h.Store.SendMessage(ctx, convoID, userID, content)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to send message"})
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (h *ConversationHandler) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	if err := h.Store.MarkRead(r.Context(), convoID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	ctx := r.Context()

	isGroup, err := h.Store.IsGroupConversation(ctx, convoID, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if !isGroup {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot leave a 1:1 conversation"})
		return
	}
	_ = h.Store.LeaveConversation(ctx, convoID, userID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("access_token")
	if tokenStr == "" {
		tokenStr = extractTokenFromRequest(r)
	}
	if tokenStr == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return
	}
	claims, err := shared.ValidateJWT(tokenStr)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}
	userID := claims.Subject

	client := &shared.SSEClient{
		Channel: "dm_changes",
		FilterFunc: func(data map[string]interface{}) bool {
			memberIDs, ok := data["member_ids"]
			if !ok {
				return false
			}
			arr, ok := memberIDs.([]interface{})
			if !ok {
				return false
			}
			for _, id := range arr {
				if fmt.Sprintf("%v", id) == userID {
					return true
				}
			}
			return false
		},
		Send: make(chan []byte, 32),
		Done: make(chan struct{}),
	}

	h.SSEHub.Register(client)
	defer func() {
		h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	shared.ServeSSE(w, r, client)
}

// --- Legacy /api/dms/{userId} routes ---

func (h *ConversationHandler) HandleLegacyGetMessages(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	r.SetPathValue("conversationId", convoID)
	h.HandleGetMessages(w, r)
}

func (h *ConversationHandler) HandleLegacySendMessage(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	r.SetPathValue("conversationId", convoID)
	h.HandleSendMessage(w, r)
}

func (h *ConversationHandler) HandleLegacyMarkRead(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	r.SetPathValue("conversationId", convoID)
	h.HandleMarkRead(w, r)
}

func (h *ConversationHandler) resolveConversationID(w http.ResponseWriter, r *http.Request) string {
	userID := shared.UserIDFromContext(r.Context())
	otherUserID := r.PathValue("userId")
	if otherUserID == "" || otherUserID == userID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return ""
	}
	convoID, err := h.Store.FindOrCreate1to1Conversation(r.Context(), userID, otherUserID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return ""
	}
	return convoID
}
