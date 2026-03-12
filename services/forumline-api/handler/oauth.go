package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/forumline/forumline/services/forumline-api/store"
	"github.com/forumline/forumline/services/forumline-api/templates"
	"github.com/golang-jwt/jwt/v5"
	shared "github.com/forumline/forumline/shared-go"
	"golang.org/x/crypto/bcrypt"
)

type OAuthHandler struct {
	Store *store.Store
}

func NewOAuthHandler(s *store.Store) *OAuthHandler {
	return &OAuthHandler{Store: s}
}

func (h *OAuthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	redirectURI := r.URL.Query().Get("redirect_uri")
	state := r.URL.Query().Get("state")

	if clientID == "" || redirectURI == "" || state == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_id, redirect_uri, and state are required"})
		return
	}

	ctx := r.Context()

	// Validate client
	client, err := h.Store.GetOAuthClient(ctx, clientID)
	if err != nil || client == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid client_id"})
		return
	}

	uriAllowed := false
	for _, uri := range client.RedirectURIs {
		if uri == redirectURI {
			uriAllowed = true
			break
		}
	}
	if !uriAllowed {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid redirect_uri"})
		return
	}

	forumName := h.Store.GetForumName(ctx, client.ForumID)
	if forumName == "" {
		forumName = "a forum"
	}

	// Try to authenticate
	var userID string
	if auth := r.Header.Get("Authorization"); auth != "" && len(auth) > 7 {
		if claims, err := shared.ValidateJWT(auth[7:]); err == nil {
			userID = claims.Subject
		}
	}
	if userID == "" {
		var pendingToken string
		if cookie, err := r.Cookie("forumline_pending_auth"); err == nil {
			pendingToken = cookie.Value
		}
		if pendingToken == "" && r.Method == http.MethodPost {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			_ = r.ParseForm()
			pendingToken = r.FormValue("access_token")
			if pendingToken == "" {
				var body map[string]string
				_ = json.NewDecoder(r.Body).Decode(&body)
				pendingToken = body["access_token"]
			}
		}
		if pendingToken != "" {
			if claims, err := shared.ValidateJWT(pendingToken); err == nil {
				userID = claims.Subject
			}
		}
	}

	if userID == "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(templates.RenderLoginPage(clientID, redirectURI, state, forumName))) // #nosec G705 -- forumName is HTML-escaped in RenderLoginPage
		return
	}

	// Generate auth code
	codeBytes := make([]byte, 32)
	if _, err := rand.Read(codeBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate authorization code"})
		return
	}
	code := hex.EncodeToString(codeBytes)

	if err := h.Store.CreateAuthCode(ctx, code, userID, client.ForumID, redirectURI, time.Now().Add(5*time.Minute)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate authorization code"})
		return
	}

	// Upsert membership
	_ = h.Store.UpsertMembership(ctx, userID, client.ForumID)

	clearPendingAuthCookie(w)

	redirectURL, _ := url.Parse(redirectURI)
	q := redirectURL.Query()
	q.Set("code", code)
	q.Set("state", state)
	redirectURL.RawQuery = q.Encode()
	http.Redirect(w, r, redirectURL.String(), http.StatusFound)
}

func (h *OAuthHandler) HandleToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code         string `json:"code"`
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		RedirectURI  string `json:"redirect_uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Code == "" || body.ClientID == "" || body.ClientSecret == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "code, client_id, and client_secret are required"})
		return
	}

	ctx := r.Context()

	client, err := h.Store.GetOAuthClientWithSecret(ctx, body.ClientID)
	if err != nil || client == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid client credentials"})
		return
	}

	// Verify secret (bcrypt or SHA-256 legacy)
	valid := bcrypt.CompareHashAndPassword([]byte(client.ClientSecretHash), []byte(body.ClientSecret)) == nil
	if !valid {
		h := sha256.Sum256([]byte(body.ClientSecret))
		valid = client.ClientSecretHash == hex.EncodeToString(h[:])
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid client credentials"})
		return
	}

	authCode, err := h.Store.ConsumeAuthCode(ctx, body.Code, client.ForumID)
	if err != nil || authCode == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid or expired authorization code"})
		return
	}
	if time.Now().After(authCode.ExpiresAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Authorization code expired"})
		return
	}
	if body.RedirectURI != "" && authCode.RedirectURI != body.RedirectURI {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "redirect_uri mismatch"})
		return
	}

	profile, err := h.Store.GetProfile(ctx, authCode.UserID)
	if err != nil || profile == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "User profile not found"})
		return
	}

	avatarURL := ""
	if profile.AvatarURL != nil {
		avatarURL = *profile.AvatarURL
	}
	identity := map[string]interface{}{
		"forumline_id": profile.ID, "username": profile.Username,
		"display_name": profile.DisplayName, "avatar_url": avatarURL,
	}
	if profile.Bio != nil && *profile.Bio != "" {
		identity["bio"] = *profile.Bio
	}

	jwtSecret := os.Getenv("FORUMLINE_JWT_SECRET")
	if jwtSecret == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Server misconfiguration"})
		return
	}

	identityToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"identity": identity, "forum_id": client.ForumID,
		"iss": "forumline-central-services", "exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, err := identityToken.SignedString([]byte(jwtSecret))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to sign token"})
		return
	}

	response := map[string]interface{}{
		"identity_token": tokenStr, "identity": identity,
		"token_type": "Bearer", "expires_in": 3600,
	}
	if fat := generateForumlineAccessToken(authCode.UserID); fat != "" {
		response["forumline_access_token"] = fat
	}

	writeJSON(w, http.StatusOK, response)
}

func generateForumlineAccessToken(userID string) string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return ""
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject: userID, IssuedAt: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)), Issuer: "forumline-app",
	})
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		return ""
	}
	return tokenStr
}
