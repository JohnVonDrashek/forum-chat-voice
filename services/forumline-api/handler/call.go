package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/forumline/forumline/services/forumline-api/service"
	shared "github.com/forumline/forumline/shared-go"
	"github.com/livekit/protocol/auth"
)

// LiveKitConfig holds connection details for the shared LiveKit server.
type LiveKitConfig struct {
	URL       string
	APIKey    string
	APISecret string
}

type CallHandler struct {
	Service *service.CallService
	SSEHub  *shared.SSEHub
	LiveKit *LiveKitConfig
}

func NewCallHandler(svc *service.CallService, hub *shared.SSEHub, lk *LiveKitConfig) *CallHandler {
	return &CallHandler{Service: svc, SSEHub: hub, LiveKit: lk}
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

// HandleToken generates a LiveKit access token for a call participant.
// Both caller and callee call this after the call is accepted to join
// the shared LiveKit room (room name = "call-{callId}").
func (h *CallHandler) HandleToken(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	callID := r.PathValue("callId")

	if h.LiveKit == nil || h.LiveKit.APIKey == "" || h.LiveKit.APISecret == "" || h.LiveKit.URL == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "LiveKit not configured"})
		return
	}

	ok, _ := h.Service.Store.IsCallParticipant(r.Context(), callID, userID)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not a participant of this call"})
		return
	}

	profile, _ := h.Service.Store.GetProfile(r.Context(), userID)
	participantName := userID
	if profile != nil {
		if profile.DisplayName != "" {
			participantName = profile.DisplayName
		} else {
			participantName = profile.Username
		}
	}

	at := auth.NewAccessToken(h.LiveKit.APIKey, h.LiveKit.APISecret)
	grant := &auth.VideoGrant{
		Room:         "call-" + callID,
		RoomJoin:     true,
		CanPublish:   boolPtr(true),
		CanSubscribe: boolPtr(true),
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID).
		SetName(participantName).
		SetValidFor(time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"url":   h.LiveKit.URL,
	})
}

func boolPtr(b bool) *bool { return &b }

func (h *CallHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

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
