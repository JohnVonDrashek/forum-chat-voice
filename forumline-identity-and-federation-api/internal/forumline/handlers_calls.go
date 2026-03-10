package forumline

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
)

type CallRecord struct {
	ID              string  `json:"id"`
	ConversationID  string  `json:"conversation_id"`
	CallerID        string  `json:"caller_id"`
	CalleeID        string  `json:"callee_id"`
	Status          string  `json:"status"`
	StartedAt       *string `json:"started_at"`
	EndedAt         *string `json:"ended_at"`
	DurationSeconds *int    `json:"duration_seconds"`
	CreatedAt       string  `json:"created_at"`
}

// HandleInitiateCall creates a new call in a 1:1 conversation.
// POST /api/calls
func (h *Handlers) HandleInitiateCall(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ConversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversation_id is required"})
		return
	}

	// Verify 1:1 conversation and get the callee
	var calleeID string
	err := h.Pool.QueryRow(ctx,
		`SELECT cm2.user_id FROM forumline_conversations c
		 JOIN forumline_conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
		 JOIN forumline_conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != $1
		 WHERE c.id = $2 AND c.is_group = false
		 AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2`,
		userID, body.ConversationID,
	).Scan(&calleeID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "1:1 conversation not found"})
		return
	}

	// Check no existing ringing/active call in this conversation
	var existingCall bool
	if err := h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE conversation_id = $1 AND status IN ('ringing', 'active'))`,
		body.ConversationID,
	).Scan(&existingCall); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check call status"})
		return
	}
	if existingCall {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Call already in progress"})
		return
	}

	// Check caller doesn't have another active call
	var callerBusy bool
	if err := h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('ringing', 'active'))`,
		userID,
	).Scan(&callerBusy); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check call status"})
		return
	}
	if callerBusy {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "You are already in a call"})
		return
	}

	// Check callee isn't busy with another call
	var calleeBusy bool
	if err := h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('ringing', 'active'))`,
		calleeID,
	).Scan(&calleeBusy); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check call status"})
		return
	}
	if calleeBusy {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "User is busy"})
		return
	}

	// Create call record
	var call CallRecord
	var createdAt time.Time
	err = h.Pool.QueryRow(ctx,
		`INSERT INTO forumline_calls (conversation_id, caller_id, callee_id, status)
		 VALUES ($1, $2, $3, 'ringing')
		 RETURNING id, conversation_id, caller_id, callee_id, status, created_at`,
		body.ConversationID, userID, calleeID,
	).Scan(&call.ID, &call.ConversationID, &call.CallerID, &call.CalleeID, &call.Status, &createdAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create call"})
		return
	}
	call.CreatedAt = createdAt.Format(time.RFC3339)

	// Get caller info for notification
	var callerUsername, callerDisplayName string
	var callerAvatarURL *string
	if err := h.Pool.QueryRow(ctx,
		`SELECT username, display_name, avatar_url FROM forumline_profiles WHERE id = $1`, userID,
	).Scan(&callerUsername, &callerDisplayName, &callerAvatarURL); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to get caller info"})
		return
	}

	displayName := callerDisplayName
	if displayName == "" {
		displayName = callerUsername
	}

	// Notify callee via SSE
	signalData, _ := json.Marshal(map[string]interface{}{
		"type":             "incoming_call",
		"call_id":          call.ID,
		"conversation_id":  call.ConversationID,
		"caller_id":        userID,
		"caller_username":  callerUsername,
		"caller_display_name": displayName,
		"caller_avatar_url":  callerAvatarURL,
		"target_user_id":   calleeID,
	})
	shared.LogIfErr(ctx, "pg_notify call_signal", func() error {
		_, err := h.Pool.Exec(ctx, "SELECT pg_notify('call_signal', $1)", string(signalData))
		return err
	})

	// Send push notification to callee (use background context since HTTP handler returns immediately)
	// #nosec G118 -- goroutine intentionally outlives the request for cleanup
	go func() {
		bgCtx := context.Background()
		title := fmt.Sprintf("Incoming call from %s", displayName)
		sent := sendPushNotifications(bgCtx, h.Pool.Pool, calleeID, title, "Tap to answer", "", "")
		if sent > 0 {
			log.Printf("Call push: sent %d notifications to %s", sent, calleeID)
		}
	}()

	writeJSON(w, http.StatusCreated, call)
}

// HandleRespondToCall accepts or declines a call.
// POST /api/calls/{callId}/respond
func (h *Handlers) HandleRespondToCall(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := chi.URLParam(r, "callId")
	ctx := r.Context()

	var body struct {
		Action string `json:"action"` // "accept" or "decline"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if body.Action != "accept" && body.Action != "decline" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "action must be 'accept' or 'decline'"})
		return
	}

	// Verify caller is the callee and call is ringing
	var callerID string
	err := h.Pool.QueryRow(ctx,
		`SELECT caller_id FROM forumline_calls WHERE id = $1 AND callee_id = $2 AND status = 'ringing'`,
		callID, userID,
	).Scan(&callerID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Call not found or already responded"})
		return
	}

	var signalType string
	if body.Action == "accept" {
		_, err = h.Pool.Exec(ctx,
			`UPDATE forumline_calls SET status = 'active', started_at = now() WHERE id = $1`,
			callID,
		)
		signalType = "call_accepted"
	} else {
		_, err = h.Pool.Exec(ctx,
			`UPDATE forumline_calls SET status = 'declined', ended_at = now() WHERE id = $1`,
			callID,
		)
		signalType = "call_declined"
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update call"})
		return
	}

	// Notify caller
	signalData, _ := json.Marshal(map[string]interface{}{
		"type":           signalType,
		"call_id":        callID,
		"target_user_id": callerID,
	})
	shared.LogIfErr(ctx, "pg_notify call_signal", func() error {
		_, err := h.Pool.Exec(ctx, "SELECT pg_notify('call_signal', $1)", string(signalData))
		return err
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": body.Action + "ed"})
}

// HandleEndCall ends an active or ringing call.
// POST /api/calls/{callId}/end
func (h *Handlers) HandleEndCall(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := chi.URLParam(r, "callId")
	ctx := r.Context()

	// Get call and verify participant
	var callerID, calleeID, status string
	var startedAt *time.Time
	err := h.Pool.QueryRow(ctx,
		`SELECT caller_id, callee_id, status, started_at FROM forumline_calls
		 WHERE id = $1 AND (caller_id = $2 OR callee_id = $2) AND status IN ('ringing', 'active')`,
		callID, userID,
	).Scan(&callerID, &calleeID, &status, &startedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Active call not found"})
		return
	}

	// Determine new status
	newStatus := "completed"
	if status == "ringing" {
		if userID == callerID {
			newStatus = "cancelled"
		} else {
			newStatus = "missed"
		}
	}

	// Compute duration if call was active
	var durationSQL string
	if status == "active" && startedAt != nil {
		durationSQL = ", duration_seconds = EXTRACT(EPOCH FROM now() - started_at)::integer"
	}

	_, err = h.Pool.Exec(ctx,
		fmt.Sprintf(`UPDATE forumline_calls SET status = $1, ended_at = now()%s WHERE id = $2`, durationSQL),
		newStatus, callID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to end call"})
		return
	}

	// Notify the other party
	otherUserID := calleeID
	if userID == calleeID {
		otherUserID = callerID
	}
	signalData, _ := json.Marshal(map[string]interface{}{
		"type":           "call_ended",
		"call_id":        callID,
		"ended_by":       userID,
		"target_user_id": otherUserID,
	})
	shared.LogIfErr(ctx, "pg_notify call_signal", func() error {
		_, err := h.Pool.Exec(ctx, "SELECT pg_notify('call_signal', $1)", string(signalData))
		return err
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": newStatus})
}

// HandleCallSignal relays WebRTC signaling (offer/answer/ICE candidates).
// POST /api/calls/signal
func (h *Handlers) HandleCallSignal(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		TargetUserID string          `json:"target_user_id"`
		CallID       string          `json:"call_id"`
		Type         string          `json:"type"` // offer, answer, ice-candidate
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

	// Verify sender is a participant of this call and target is the other participant
	var exists bool
	if err := h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls
		 WHERE id = $1 AND status IN ('ringing', 'active')
		 AND ((caller_id = $2 AND callee_id = $3) OR (caller_id = $3 AND callee_id = $2)))`,
		body.CallID, userID, body.TargetUserID,
	).Scan(&exists); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to verify call"})
		return
	}
	if !exists {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Not a participant of this call"})
		return
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type":           body.Type,
		"call_id":        body.CallID,
		"sender_id":      userID,
		"target_user_id": body.TargetUserID,
		"payload":        body.Payload,
	})
	shared.LogIfErr(ctx, "pg_notify call_signal", func() error {
		_, err := h.Pool.Exec(ctx, "SELECT pg_notify('call_signal', $1)", string(signalData))
		return err
	})

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// HandleCallSignalStream provides SSE for real-time call signaling.
// GET /api/calls/stream
func (h *Handlers) HandleCallSignalStream(w http.ResponseWriter, r *http.Request) {
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
