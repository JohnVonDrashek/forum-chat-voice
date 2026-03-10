package forumline

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
	"golang.org/x/crypto/bcrypt"
)

// HandleOAuthAuthorize validates the OAuth client and either shows the login page
// or generates an auth code and redirects.
func (h *Handlers) HandleOAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := paramFromRequest(r, "client_id")
	redirectURI := paramFromRequest(r, "redirect_uri")
	state := paramFromRequest(r, "state")

	if clientID == "" || redirectURI == "" || state == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_id, redirect_uri, and state are required"})
		return
	}

	ctx := r.Context()

	// Validate client_id and redirect_uri
	var clientDBID, forumID string
	var redirectURIs []string
	err := h.Pool.QueryRow(ctx,
		`SELECT oc.id, oc.forum_id, oc.redirect_uris
		 FROM forumline_oauth_clients oc
		 WHERE oc.client_id = $1`, clientID,
	).Scan(&clientDBID, &forumID, &redirectURIs)

	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid client_id"})
		return
	}

	uriAllowed := false
	for _, uri := range redirectURIs {
		if uri == redirectURI {
			uriAllowed = true
			break
		}
	}
	if !uriAllowed {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid redirect_uri"})
		return
	}

	// Fetch forum name for display
	var forumName string
	_ = h.Pool.QueryRow(ctx,
		`SELECT COALESCE(name, domain) FROM forumline_forums WHERE id = $1`, forumID,
	).Scan(&forumName)
	if forumName == "" {
		forumName = "a forum"
	}

	// Try to authenticate the user from various sources
	var userID string

	// 1. Bearer token in Authorization header
	if auth := r.Header.Get("Authorization"); auth != "" && len(auth) > 7 {
		tokenStr := auth[7:]
		if claims, err := shared.ValidateJWT(tokenStr); err == nil {
			userID = claims.Subject
		}
	}

	// 2. forumline_pending_auth cookie or access_token in POST body
	if userID == "" {
		var pendingToken string
		if cookie, err := r.Cookie("forumline_pending_auth"); err == nil {
			pendingToken = cookie.Value
		}
		if pendingToken == "" && r.Method == http.MethodPost {
			// Try form-encoded first, then JSON
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

	// Not authenticated — serve login page
	if userID == "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(renderLoginPage(clientID, redirectURI, state, forumName)))
		return
	}

	// Generate authorization code
	codeBytes := make([]byte, 32)
	if _, err := rand.Read(codeBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate authorization code"})
		return
	}
	code := hex.EncodeToString(codeBytes)
	expiresAt := time.Now().Add(5 * time.Minute)

	_, err = h.Pool.Exec(ctx,
		`INSERT INTO forumline_auth_codes (code, user_id, forum_id, redirect_uri, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		code, userID, forumID, redirectURI, expiresAt,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate authorization code"})
		return
	}

	// Upsert membership
	shared.LogIfErr(ctx, "upsert membership on OAuth authorize", func() error {
		_, err := h.Pool.Exec(ctx,
			`INSERT INTO forumline_memberships (user_id, forum_id)
			 VALUES ($1, $2)
			 ON CONFLICT (user_id, forum_id) DO NOTHING`,
			userID, forumID,
		)
		return err
	})

	// Clear pending auth cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "forumline_pending_auth",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   true,
		MaxAge:   -1,
	})

	// Redirect with code and state
	redirectURL, _ := url.Parse(redirectURI)
	q := redirectURL.Query()
	q.Set("code", code)
	q.Set("state", state)
	redirectURL.RawQuery = q.Encode()

	http.Redirect(w, r, redirectURL.String(), http.StatusFound)
}

// HandleOAuthToken exchanges an auth code for an identity JWT.
func (h *Handlers) HandleOAuthToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

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

	// Validate client credentials
	var clientForumID, storedHash string
	err := h.Pool.QueryRow(ctx,
		`SELECT forum_id, client_secret_hash FROM forumline_oauth_clients WHERE client_id = $1`,
		body.ClientID,
	).Scan(&clientForumID, &storedHash)

	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid client credentials"})
		return
	}

	// Support both bcrypt (new) and SHA-256 (legacy) hashes
	valid := false
	if bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(body.ClientSecret)) == nil {
		valid = true
	} else if storedHash == sha256Hex(body.ClientSecret) {
		valid = true
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid client credentials"})
		return
	}

	// Validate and consume auth code
	var authCodeID, authUserID, authRedirectURI string
	var expiresAt time.Time
	err = h.Pool.QueryRow(ctx,
		`SELECT id, user_id, redirect_uri, expires_at
		 FROM forumline_auth_codes
		 WHERE code = $1 AND forum_id = $2 AND used = false`,
		body.Code, clientForumID,
	).Scan(&authCodeID, &authUserID, &authRedirectURI, &expiresAt)

	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid or expired authorization code"})
		return
	}

	if time.Now().After(expiresAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Authorization code expired"})
		return
	}

	if body.RedirectURI != "" && authRedirectURI != body.RedirectURI {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "redirect_uri mismatch"})
		return
	}

	// Mark code as used
	shared.LogIfErr(ctx, "mark auth code as used", func() error {
		_, err := h.Pool.Exec(ctx, `UPDATE forumline_auth_codes SET used = true WHERE id = $1`, authCodeID)
		return err
	})

	// Fetch user profile
	var profile struct {
		ID          string
		Username    string
		DisplayName string
		AvatarURL   *string
		Bio         *string
	}
	err = h.Pool.QueryRow(ctx,
		`SELECT id, username, display_name, avatar_url, bio FROM forumline_profiles WHERE id = $1`,
		authUserID,
	).Scan(&profile.ID, &profile.Username, &profile.DisplayName, &profile.AvatarURL, &profile.Bio)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "User profile not found"})
		return
	}

	// Build identity
	avatarURL := ""
	if profile.AvatarURL != nil {
		avatarURL = *profile.AvatarURL
	}
	bio := ""
	if profile.Bio != nil {
		bio = *profile.Bio
	}

	identity := map[string]interface{}{
		"forumline_id": profile.ID,
		"username":     profile.Username,
		"display_name": profile.DisplayName,
		"avatar_url":   avatarURL,
	}
	if bio != "" {
		identity["bio"] = bio
	}

	// Sign identity JWT
	jwtSecret := os.Getenv("FORUMLINE_JWT_SECRET")
	if jwtSecret == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Server misconfiguration"})
		return
	}

	identityToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"identity": identity,
		"forum_id": clientForumID,
		"iss":      "forumline-central-services",
		"exp":      time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, err := identityToken.SignedString([]byte(jwtSecret))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to sign token"})
		return
	}

	// Generate forumline access token via GoTrue magic link
	forumlineAccessToken := generateForumlineAccessToken(authUserID)

	response := map[string]interface{}{
		"identity_token": tokenStr,
		"identity":       identity,
		"token_type":     "Bearer",
		"expires_in":     3600,
	}
	if forumlineAccessToken != "" {
		response["forumline_access_token"] = forumlineAccessToken
	}

	writeJSON(w, http.StatusOK, response)
}

// generateForumlineAccessToken mints a JWT for the user signed with JWT_SECRET.
// This token is valid for authenticated forumline API endpoints (DMs, memberships, etc.).
// Best-effort — if it fails, DMs won't work but identity federation still does.
func generateForumlineAccessToken(userID string) string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return ""
	}

	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		Issuer:    "forumline-app",
	})

	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		return ""
	}
	return tokenStr
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// paramFromRequest gets a parameter from query string or POST body.
func paramFromRequest(r *http.Request, key string) string {
	if v := r.URL.Query().Get(key); v != "" {
		return v
	}
	return ""
}
