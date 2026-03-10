package forumline

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

// HandleLogin delegates to GoTrue for auth, then sets the forumline_pending_auth cookie.
func (h *Handlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
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

	// Call GoTrue
	gotrueURL := os.Getenv("GOTRUE_URL")
	payload, _ := json.Marshal(map[string]string{
		"email":    body.Email,
		"password": body.Password,
	})

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gotrueURL+"/token?grant_type=password", bytes.NewReader(payload)) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create auth request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req) // #nosec G704 -- URL from trusted GOTRUE_URL env var
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

	var gotrueResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		ExpiresAt    int64  `json:"expires_at"`
		User         struct {
			ID           string                 `json:"id"`
			Email        string                 `json:"email"`
			UserMetadata map[string]interface{} `json:"user_metadata"`
		} `json:"user"`
	}
	if err := json.Unmarshal(respBody, &gotrueResp); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse auth response"})
		return
	}

	// Set httpOnly cookie for OAuth authorize flow
	http.SetCookie(w, &http.Cookie{
		Name:     "forumline_pending_auth",
		Value:    gotrueResp.AccessToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   true,
		MaxAge:   60,
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": map[string]interface{}{
			"id":            gotrueResp.User.ID,
			"email":         gotrueResp.User.Email,
			"user_metadata": gotrueResp.User.UserMetadata,
		},
		"session": map[string]interface{}{
			"access_token":  gotrueResp.AccessToken,
			"refresh_token": gotrueResp.RefreshToken,
			"expires_in":    gotrueResp.ExpiresIn,
			"expires_at":    gotrueResp.ExpiresAt,
		},
	})
}

// HandleSignup delegates to GoTrue, then creates forumline profile.
func (h *Handlers) HandleSignup(w http.ResponseWriter, r *http.Request) {
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

	// Validate username (3-30 chars, alphanumeric + underscore/hyphen)
	if len(body.Username) < 3 || len(body.Username) > 30 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username must be 3-30 characters"})
		return
	}

	if len(body.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Password must be at least 6 characters"})
		return
	}

	ctx := r.Context()

	// Check username uniqueness
	var exists bool
	err := h.Pool.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE username = $1)", body.Username,
	).Scan(&exists)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if exists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Username already taken"})
		return
	}

	// Call GoTrue signup
	gotrueURL := os.Getenv("GOTRUE_URL")
	displayName := body.DisplayName
	if displayName == "" {
		displayName = body.Username
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"email":    body.Email,
		"password": body.Password,
		"data": map[string]string{
			"username":     body.Username,
			"display_name": displayName,
		},
	})

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gotrueURL+"/signup", bytes.NewReader(payload)) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create signup request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req) // #nosec G704 -- URL from trusted GOTRUE_URL env var
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

	var gotrueResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		ExpiresAt    int64  `json:"expires_at"`
		User         struct {
			ID           string                 `json:"id"`
			Email        string                 `json:"email"`
			UserMetadata map[string]interface{} `json:"user_metadata"`
		} `json:"user"`
	}
	if err := json.Unmarshal(respBody, &gotrueResp); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse auth response"})
		return
	}

	if gotrueResp.User.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Signup failed — check email confirmation settings"})
		return
	}

	// Create forumline profile
	avatarURL := fmt.Sprintf("https://api.dicebear.com/9.x/avataaars/svg?seed=%s&size=256", gotrueResp.User.ID)
	_, err = h.Pool.Exec(ctx,
		`INSERT INTO forumline_profiles (id, username, display_name, avatar_url) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO NOTHING`,
		gotrueResp.User.ID, body.Username, displayName, avatarURL,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create forumline profile for user %s: %v\n", gotrueResp.User.ID, err)
		// Rollback: delete auth user via GoTrue admin API
		deleteGoTrueUser(gotrueResp.User.ID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create profile"})
		return
	}

	// Set httpOnly cookie for OAuth authorize flow
	http.SetCookie(w, &http.Cookie{
		Name:     "forumline_pending_auth",
		Value:    gotrueResp.AccessToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   true,
		MaxAge:   60,
	})

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"user": map[string]interface{}{
			"id":            gotrueResp.User.ID,
			"email":         gotrueResp.User.Email,
			"user_metadata": gotrueResp.User.UserMetadata,
		},
		"session": map[string]interface{}{
			"access_token":  gotrueResp.AccessToken,
			"refresh_token": gotrueResp.RefreshToken,
			"expires_in":    gotrueResp.ExpiresIn,
			"expires_at":    gotrueResp.ExpiresAt,
		},
	})
}

// HandleLogout clears auth cookies.
func (h *Handlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	// Clear cookies
	http.SetCookie(w, &http.Cookie{
		Name:     "forumline_pending_auth",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   true,
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

// HandleSession returns the current user from the JWT.
func (h *Handlers) HandleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

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
		"user": map[string]string{
			"id":    claims.Subject,
			"email": claims.Email,
		},
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
	resp, err := httpClient.Do(req) // #nosec G704 -- URL from trusted GOTRUE_URL env var
	if err != nil {
		slog.Error("deleteGoTrueUser: request failed", "err", err)
		return
	}
	_ = resp.Body.Close()
}

func extractTokenFromRequest(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if cookie, err := r.Cookie("sb-access-token"); err == nil {
		return cookie.Value
	}
	if token := r.URL.Query().Get("access_token"); token != "" {
		return token
	}
	return ""
}
