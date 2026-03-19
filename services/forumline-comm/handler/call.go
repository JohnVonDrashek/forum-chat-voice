package handler

import (
	"log"
	"net/http"
	"os"
	"time"

	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-comm/service"
)

type CallHandler struct {
	CallService *service.CallService
	LKConfig    *LiveKitConfig
}

type LiveKitConfig struct {
	URL       string
	APIKey    string
	APISecret string
}

func NewCallHandler(cs *service.CallService, lk *LiveKitConfig) *CallHandler {
	return &CallHandler{CallService: cs, LKConfig: lk}
}

func (h *CallHandler) HandleInitiate(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ConversationID uuid.UUID `json:"conversation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	result, err := h.CallService.Initiate(r.Context(), userID, body.ConversationID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result.Call)
}

func (h *CallHandler) HandleRespond(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	callID, err := uuid.Parse(chi.URLParam(r, "callId"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid call ID"})
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	result, err := h.CallService.Respond(r.Context(), userID, callID, body.Action)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": result.Status})
}

func (h *CallHandler) HandleEnd(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	callID, err := uuid.Parse(chi.URLParam(r, "callId"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid call ID"})
		return
	}
	result, err := h.CallService.End(r.Context(), userID, callID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": result.Status})
}

func (h *CallHandler) HandleGetToken(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	callID, err := uuid.Parse(chi.URLParam(r, "callId"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid call ID"})
		return
	}

	lk := h.LKConfig
	if lk == nil || lk.APIKey == "" || lk.APISecret == "" || lk.URL == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "LiveKit not configured"})
		return
	}

	ok, _ := h.CallService.IsCallParticipant(r.Context(), callID, userID)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not a participant of this call"})
		return
	}

	call, err := h.CallService.GetCallByID(r.Context(), callID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "call not found"})
		return
	}

	roomName := call.RoomName
	if roomName == "" {
		roomName = "call-" + callID.String() // fallback for legacy records
	}

	participantName := h.CallService.GetProfileDisplayName(r.Context(), userID)

	boolTrue := true
	at := lkauth.NewAccessToken(lk.APIKey, lk.APISecret)
	grant := &lkauth.VideoGrant{
		Room:         roomName,
		RoomJoin:     true,
		CanPublish:   &boolTrue,
		CanSubscribe: &boolTrue,
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
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "url": lk.URL})
}

// HandleLiveKitWebhook receives and validates LiveKit webhook events.
func (h *CallHandler) HandleLiveKitWebhook(w http.ResponseWriter, r *http.Request) {
	lk := h.LKConfig
	if lk == nil || lk.APIKey == "" || lk.APISecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "LiveKit not configured"})
		return
	}

	keyProvider := lkauth.NewSimpleKeyProvider(lk.APIKey, lk.APISecret)
	event, err := webhook.ReceiveWebhookEvent(r, keyProvider)
	if err != nil {
		log.Printf("[LiveKit Webhook] Failed to validate: %v", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid webhook signature"})
		return
	}

	room := event.GetRoom()
	if room == nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	roomName := room.GetName()

	switch event.GetEvent() {
	case "room_finished":
		h.CallService.HandleRoomFinished(r.Context(), roomName, room)
	case "participant_joined":
		h.CallService.HandleParticipantJoined(r.Context(), roomName, room.GetNumParticipants())
	}

	w.WriteHeader(http.StatusOK)
}

func NewLiveKitConfigFromEnv() *LiveKitConfig {
	return &LiveKitConfig{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
}
