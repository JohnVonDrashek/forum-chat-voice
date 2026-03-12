package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type CallHandler struct {
	Store       *store.Store
	SSEHub      *shared.SSEHub
	PushService *service.PushService
}

func NewCallHandler(s *store.Store, hub *shared.SSEHub, ps *service.PushService) *CallHandler {
	return &CallHandler{Store: s, SSEHub: hub, PushService: ps}
}

func (h *CallHandler) HandleInitiate(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ConversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversation_id is required"})
		return
	}

	calleeID, err := h.Store.GetCalleeFor1to1(ctx, userID, body.ConversationID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "1:1 conversation not found"})
		return
	}

	if active, _ := h.Store.HasActiveCall(ctx, body.ConversationID); active {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Call already in progress"})
		return
	}
	if busy, _ := h.Store.IsUserInCall(ctx, userID); busy {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "You are already in a call"})
		return
	}
	if busy, _ := h.Store.IsUserInCall(ctx, calleeID); busy {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "User is busy"})
		return
	}

	call, err := h.Store.CreateCall(ctx, body.ConversationID, userID, calleeID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create call"})
		return
	}

	// Get caller info
	callerProfile, err := h.Store.GetProfile(ctx, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get caller info"})
		return
	}
	displayName := "Unknown"
	callerUsername := ""
	var callerAvatarURL *string
	if callerProfile != nil {
		callerUsername = callerProfile.Username
		displayName = callerProfile.DisplayName
		if displayName == "" {
			displayName = callerUsername
		}
		callerAvatarURL = callerProfile.AvatarURL
	}

	// Notify callee via SSE
	signalData, _ := json.Marshal(map[string]interface{}{
		"type": "incoming_call", "call_id": call.ID, "conversation_id": call.ConversationID,
		"caller_id": userID, "caller_username": callerUsername,
		"caller_display_name": displayName, "caller_avatar_url": callerAvatarURL,
		"target_user_id": calleeID,
	})
	_ = h.Store.NotifyCallSignal(ctx, string(signalData))

	// Send push in background (intentionally detached from request context)
	go func() { // #nosec G118 -- push must outlive HTTP request
		title := fmt.Sprintf("Incoming call from %s", displayName)
		sent := h.PushService.SendToUser(context.Background(), calleeID, title, "Tap to answer", "", "")
		if sent > 0 {
			log.Printf("Call push: sent %d notifications to %s", sent, calleeID)
		}
	}()

	writeJSON(w, http.StatusCreated, call)
}

func (h *CallHandler) HandleRespond(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := r.PathValue("callId")
	ctx := r.Context()

	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if body.Action != "accept" && body.Action != "decline" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "action must be 'accept' or 'decline'"})
		return
	}

	callerID, err := h.Store.GetRingingCallCallerID(ctx, callID, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Call not found or already responded"})
		return
	}

	signalType := "call_accepted"
	if body.Action == "accept" {
		err = h.Store.AcceptCall(ctx, callID)
	} else {
		err = h.Store.DeclineCall(ctx, callID)
		signalType = "call_declined"
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update call"})
		return
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": signalType, "call_id": callID, "target_user_id": callerID,
	})
	_ = h.Store.NotifyCallSignal(ctx, string(signalData))

	writeJSON(w, http.StatusOK, map[string]string{"status": body.Action + "ed"})
}

func (h *CallHandler) HandleEnd(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := r.PathValue("callId")
	ctx := r.Context()

	newStatus, otherUserID, err := h.Store.EndCall(ctx, callID, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Active call not found"})
		return
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": "call_ended", "call_id": callID, "ended_by": userID, "target_user_id": otherUserID,
	})
	_ = h.Store.NotifyCallSignal(ctx, string(signalData))

	writeJSON(w, http.StatusOK, map[string]string{"status": newStatus})
}

func (h *CallHandler) HandleSignal(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

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
	if body.TargetUserID == "" || body.CallID == "" || body.Payload == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "target_user_id, call_id, and payload are required"})
		return
	}
	if body.Type != "offer" && body.Type != "answer" && body.Type != "ice-candidate" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "type must be offer, answer, or ice-candidate"})
		return
	}

	valid, _ := h.Store.VerifyCallParticipants(ctx, body.CallID, userID, body.TargetUserID)
	if !valid {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Not a participant of this call"})
		return
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": body.Type, "call_id": body.CallID, "sender_id": userID,
		"target_user_id": body.TargetUserID, "payload": body.Payload,
	})
	_ = h.Store.NotifyCallSignal(ctx, string(signalData))

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
