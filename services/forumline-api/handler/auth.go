package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

type AuthHandler struct {
	Store *store.Store
}

func NewAuthHandler(s *store.Store) *AuthHandler {
	return &AuthHandler{Store: s}
}

func (h *AuthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Email == "" || body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}

	gotrueURL := os.Getenv("GOTRUE_URL")
	payload, _ := json.Marshal(map[string]string{"email": body.Email, "password": body.Password})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gotrueURL+"/token?grant_type=password", bytes.NewReader(payload)) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create auth request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req) // #nosec G704
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth service unavailable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read auth response"})
		return
	}
	if resp.StatusCode != 200 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid email or password"})
		return
	}

	var gotrueResp model.GoTrueTokenResponse
	if err := json.Unmarshal(respBody, &gotrueResp); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse auth response"})
		return
	}

	setPendingAuthCookie(w, gotrueResp.AccessToken)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":    map[string]interface{}{"id": gotrueResp.User.ID, "email": gotrueResp.User.Email, "user_metadata": gotrueResp.User.UserMetadata},
		"session": map[string]interface{}{"access_token": gotrueResp.AccessToken, "refresh_token": gotrueResp.RefreshToken, "expires_in": gotrueResp.ExpiresIn, "expires_at": gotrueResp.ExpiresAt},
	})
}

func (h *AuthHandler) HandleSignup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Email == "" || body.Password == "" || body.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email, password, and username are required"})
		return
	}
	if len(body.Username) < 3 || len(body.Username) > 30 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username must be 3-30 characters"})
		return
	}
	if len(body.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Password must be at least 6 characters"})
		return
	}

	ctx := r.Context()
	exists, err := h.Store.UsernameExists(ctx, body.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if exists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Username already taken"})
		return
	}

	displayName := body.DisplayName
	if displayName == "" {
		displayName = body.Username
	}

	gotrueURL := os.Getenv("GOTRUE_URL")
	payload, _ := json.Marshal(map[string]interface{}{
		"email": body.Email, "password": body.Password,
		"data": map[string]string{"username": body.Username, "display_name": displayName},
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, gotrueURL+"/signup", bytes.NewReader(payload)) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req) // #nosec G704
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth service unavailable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read auth response"})
		return
	}

	if resp.StatusCode != 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Signup failed"})
		return
	}

	var gotrueResp model.GoTrueTokenResponse
	if err := json.Unmarshal(respBody, &gotrueResp); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse auth response"})
		return
	}
	if gotrueResp.User.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Signup failed — check email confirmation settings"})
		return
	}

	avatarURL := fmt.Sprintf("https://api.dicebear.com/9.x/avataaars/svg?seed=%s&size=256", gotrueResp.User.ID)
	if err := h.Store.CreateProfile(ctx, gotrueResp.User.ID, body.Username, displayName, avatarURL); err != nil {
		deleteGoTrueUser(gotrueResp.User.ID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create profile"})
		return
	}

	setPendingAuthCookie(w, gotrueResp.AccessToken)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"user":    map[string]interface{}{"id": gotrueResp.User.ID, "email": gotrueResp.User.Email, "user_metadata": gotrueResp.User.UserMetadata},
		"session": map[string]interface{}{"access_token": gotrueResp.AccessToken, "refresh_token": gotrueResp.RefreshToken, "expires_in": gotrueResp.ExpiresIn, "expires_at": gotrueResp.ExpiresAt},
	})
}

func (h *AuthHandler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	clearPendingAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (h *AuthHandler) HandleSession(w http.ResponseWriter, r *http.Request) {
	tokenStr := extractTokenFromRequest(r)
	if tokenStr == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return
	}
	claims, err := shared.ValidateJWT(tokenStr)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": map[string]string{"id": claims.Subject, "email": claims.Email},
	})
}

func setPendingAuthCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_pending_auth", Value: token, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 60,
	})
}

func clearPendingAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_pending_auth", Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1,
	})
}

func deleteGoTrueUser(userID string) {
	gotrueURL := os.Getenv("GOTRUE_URL")
	serviceKey := os.Getenv("GOTRUE_SERVICE_ROLE_KEY")
	if gotrueURL == "" || serviceKey == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, gotrueURL+"/admin/users/"+userID, nil) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	if err != nil {
		slog.Error("deleteGoTrueUser: failed to create request", "err", err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req) // #nosec G704
	if err != nil {
		slog.Error("deleteGoTrueUser: request failed", "err", err)
		return
	}
	_ = resp.Body.Close()
}
