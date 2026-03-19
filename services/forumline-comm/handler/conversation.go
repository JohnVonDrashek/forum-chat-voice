package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type ConversationHandler struct {
	Service *service.ConversationService
	Store   *store.Store
}

func NewConversationHandler(svc *service.ConversationService, s *store.Store) *ConversationHandler {
	return &ConversationHandler{Service: svc, Store: s}
}

func (h *ConversationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convos, err := h.Store.ListConversations(r.Context(), userID)
	if err != nil {
		log.Printf("[Conversations] list failed for user %s: %v", userID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch conversations"})
		return
	}
	writeJSON(w, http.StatusOK, convos)
}

func (h *ConversationHandler) HandleGet(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	c, err := h.Store.GetConversation(r.Context(), userID, convoID)
	if err != nil || c == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *ConversationHandler) HandleGetOrCreateDM(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	convoID, err := h.Service.GetOrCreateDM(r.Context(), userID, body.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": convoID.String()})
}

func (h *ConversationHandler) HandleCreateGroup(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		MemberIDs []string `json:"memberIds"`
		Name      string   `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	convo, err := h.Service.CreateGroup(r.Context(), userID, service.CreateGroupInput{
		Name:      trimString(body.Name),
		MemberIDs: body.MemberIDs,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	convo.LastMessageTime = time.Now().Format(time.RFC3339)
	writeJSON(w, http.StatusCreated, convo)
}

func (h *ConversationHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
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
	err = h.Service.Update(r.Context(), userID, convoID, service.UpdateInput{
		Name:          body.Name,
		AddMembers:    body.AddMembers,
		RemoveMembers: body.RemoveMembers,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleGetMessages(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	msgs, err := h.Service.GetMessages(r.Context(), userID, convoID, r.URL.Query().Get("before"), r.URL.Query().Get("limit"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *ConversationHandler) HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
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
	msg, err := h.Service.SendMessage(r.Context(), userID, convoID, body.Content)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (h *ConversationHandler) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if err := h.Store.MarkRead(r.Context(), convoID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if err := h.Service.Leave(r.Context(), userID, convoID); err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// --- Legacy /api/dms/{userId} routes ---

func (h *ConversationHandler) HandleLegacyGetMessages(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	userID := auth.UserIDFromContext(r.Context())
	msgs, err := h.Service.GetMessages(r.Context(), userID, uuid.MustParse(convoID), r.URL.Query().Get("before"), r.URL.Query().Get("limit"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *ConversationHandler) HandleLegacySendMessage(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	msg, err := h.Service.SendMessage(r.Context(), userID, uuid.MustParse(convoID), body.Content)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (h *ConversationHandler) HandleLegacyMarkRead(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		return
	}
	userID := auth.UserIDFromContext(r.Context())
	if err := h.Store.MarkRead(r.Context(), uuid.MustParse(convoID), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) resolveConversationID(w http.ResponseWriter, r *http.Request) string {
	userID := auth.UserIDFromContext(r.Context())
	otherUserID := chi.URLParam(r, "userId")
	convoID, err := h.Service.ResolveConversationID(r.Context(), userID, otherUserID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return ""
	}
	return convoID.String()
}
