package handler

import (
	"encoding/json"
	"net/http"

	"github.com/forumline/forumline/services/forumline-api/service"
	shared "github.com/forumline/forumline/shared-go"
)

type CallHandler struct {
	Service *service.CallService
	SSEHub  *shared.SSEHub
}

func NewCallHandler(svc *service.CallService, hub *shared.SSEHub) *CallHandler {
	return &CallHandler{Service: svc, SSEHub: hub}
}

func (h *CallHandler) HandleInitiate(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	var body struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	result, err := h.Service.Initiate(r.Context(), userID, body.ConversationID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result.Call)
}

func (h *CallHandler) HandleRespond(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := r.PathValue("callId")

	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	result, err := h.Service.Respond(r.Context(), userID, callID, body.Action)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": result.Status})
}

func (h *CallHandler) HandleEnd(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := r.PathValue("callId")

	result, err := h.Service.End(r.Context(), userID, callID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": result.Status})
}

func (h *CallHandler) HandleSignal(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	var body struct {
		TargetUserID string          `json:"target_user_id"`
		CallID       string          `json:"call_id"`
		Type         string          `json:"type"`
		Payload      json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	err := h.Service.Signal(r.Context(), userID, service.SignalInput{
		TargetUserID: body.TargetUserID,
		CallID:       body.CallID,
		Type:         body.Type,
		Payload:      body.Payload,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *CallHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
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
		Channel: "call_signal",
		FilterFunc: func(data map[string]interface{}) bool {
			targetID, _ := data["target_user_id"].(string)
			return targetID == userID
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
