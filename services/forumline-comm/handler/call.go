package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	lkauth "github.com/livekit/protocol/auth"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type CallHandler struct {
	CallService *service.CallService
	Store       *store.Store
	LKConfig    *LiveKitConfig
}

type LiveKitConfig struct {
	URL       string
	APIKey    string
	APISecret string
}

func NewCallHandler(cs *service.CallService, s *store.Store, lk *LiveKitConfig) *CallHandler {
	return &CallHandler{CallService: cs, Store: s, LKConfig: lk}
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

	ok, _ := h.Store.IsCallParticipant(r.Context(), callID, userID)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not a participant of this call"})
		return
	}

	token, err := generateLiveKitToken(lk.APIKey, lk.APISecret, callID.String(), userID, h.Store, r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "url": lk.URL})
}

func generateLiveKitToken(apiKey, apiSecret, callID, userID string, s *store.Store, ctx context.Context) (string, error) {
	profile, _ := s.GetProfile(ctx, userID)
	participantName := userID
	if profile != nil {
		if profile.DisplayName != "" {
			participantName = profile.DisplayName
		} else {
			participantName = profile.Username
		}
	}

	boolTrue := true
	at := lkauth.NewAccessToken(apiKey, apiSecret)
	grant := &lkauth.VideoGrant{
		Room:         "call-" + callID,
		RoomJoin:     true,
		CanPublish:   &boolTrue,
		CanSubscribe: &boolTrue,
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID).
		SetName(participantName).
		SetValidFor(time.Hour)

	return at.ToJWT()
}

func NewLiveKitConfigFromEnv() *LiveKitConfig {
	return &LiveKitConfig{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
}
