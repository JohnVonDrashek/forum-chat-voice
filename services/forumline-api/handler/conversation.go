package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-api/service"
)

type ConversationHandler struct {
	Service *service.ConversationService
}

func NewConversationHandler(svc *service.ConversationService) *ConversationHandler {
	return &ConversationHandler{Service: svc}
}

func (h *ConversationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convos, err := h.Service.List(r.Context(), userID)
	if err != nil {
		log.Printf("[Conversations] list failed for user %s: %v", userID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch conversations"})
		return
	}
	writeJSON(w, http.StatusOK, convos)
}

func (h *ConversationHandler) HandleGet(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
	c, err := h.Service.Get(r.Context(), userID, convoID)
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
	writeJSON(w, http.StatusOK, map[string]string{"id": convoID})
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
	convoID := r.PathValue("conversationId")
	var body struct {
		Name          *string  `json:"name"`
		AddMembers    []string `json:"addMembers"`
		RemoveMembers []string `json:"removeMembers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	err := h.Service.Update(r.Context(), userID, convoID, service.UpdateInput{
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
	convoID := r.PathValue("conversationId")
	msgs, err := h.Service.GetMessages(r.Context(), userID, convoID, r.URL.Query().Get("before"), r.URL.Query().Get("limit"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *ConversationHandler) HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
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
	convoID := r.PathValue("conversationId")
	if err := h.Service.MarkRead(r.Context(), userID, convoID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *ConversationHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	convoID := r.PathValue("conversationId")
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
	userID := auth.UserIDFromContext(r.Context())
	otherUserID := r.PathValue("userId")
	convoID, err := h.Service.ResolveConversationID(r.Context(), userID, otherUserID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return ""
	}
	return convoID
}

// writeServiceError maps service-layer errors to HTTP status codes.
func writeServiceError(w http.ResponseWriter, err error) {
	var validationErr *service.ValidationError
	var notFoundErr *service.NotFoundError
	var conflictErr *service.ConflictError
	var forbiddenErr *service.ForbiddenError
	switch {
	case errors.As(err, &validationErr):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": validationErr.Msg})
	case errors.As(err, &notFoundErr):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": notFoundErr.Msg})
	case errors.As(err, &conflictErr):
		writeJSON(w, http.StatusConflict, map[string]string{"error": conflictErr.Msg})
	case errors.As(err, &forbiddenErr):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": forbiddenErr.Msg})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
	}
}
