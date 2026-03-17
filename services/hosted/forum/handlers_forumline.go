package forum

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/forumline/forumline/services/hosted/forum/model"
)

// HandleForumlineAuth handles GET /api/forumline/auth.
// For direct visits: redirects to id.forumline.net to start the
// "Sign in with Forumline" flow. The id service handles the Zitadel OIDC
// dance and redirects back to our callback with an auth code.
func (h *Handlers) HandleForumlineAuth(w http.ResponseWriter, r *http.Request) {
	if h.Config.IdentityURL == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity service not configured"})
		return
	}

	callbackURL := h.Config.SiteURL + "/api/forumline/auth/callback"
	state := randomHex(16)

	// Store state in cookie for CSRF validation on callback
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_state", Value: state,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
	})

	// Redirect to the Forumline identity service
	authorizeURL := h.Config.IdentityURL + "/authorize?" + url.Values{
		"redirect_uri": {callbackURL},
		"state":        {state},
	}.Encode()

	http.Redirect(w, r, authorizeURL, http.StatusFound)
}

// HandleForumlineCallback handles GET /api/forumline/auth/callback.
// Receives an auth code from id.forumline.net, exchanges it for user info
// via the token endpoint, and creates/links the local forum profile.
func (h *Handlers) HandleForumlineCallback(w http.ResponseWriter, r *http.Request) {
	// Validate CSRF state
	cookies := parseCookies(r)
	state := r.URL.Query().Get("state")
	if state == "" || cookies["forumline_state"] != state {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "state mismatch"})
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing auth code"})
		return
	}

	// Exchange auth code with the identity service
	callbackURL := h.Config.SiteURL + "/api/forumline/auth/callback"
	userInfo, err := h.exchangeAuthCode(r, code, callbackURL)
	if err != nil {
		log.Printf("[Forumline:Callback] token exchange failed: %v", err)
		http.Redirect(w, r, h.Config.SiteURL+"/login?error=auth_failed", http.StatusFound)
		return
	}

	// Create or link local user
	identity := &model.ForumlineIdentity{
		ForumlineID: userInfo.ForumlineID,
		Username:    userInfo.Username,
		DisplayName: userInfo.DisplayName,
		AvatarURL:   userInfo.AvatarURL,
	}
	localUserID, err := h.createOrLinkUser(r, identity)
	if err != nil {
		log.Printf("[Forumline:Callback] createOrLinkUser failed: %v", err)
		http.Redirect(w, r, h.Config.SiteURL+"/login?error=auth_failed", http.StatusFound)
		return
	}

	// Clear state cookie
	clearCookie(w, "forumline_state")

	// Set local session cookie
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_user_id", Value: localUserID,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 3600,
	})

	// Redirect with access token in hash (used by frontend for API calls)
	accessToken := userInfo.AccessToken
	redirectURL := h.Config.SiteURL + "/#access_token=" + url.QueryEscape(accessToken) + "&type=bearer"
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// HandleTokenExchange handles POST /api/forumline/auth/token-exchange.
// This is the "invisible handshake" for in-app browsing. The Forumline app
// passes the user's JWT via the iframe, and the forum validates it against
// the identity service's /userinfo endpoint, then creates a local session.
func (h *Handlers) HandleTokenExchange(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "token is required"})
		return
	}

	// Validate the Forumline JWT against the identity service
	userInfo, err := h.validateForumlineToken(r, req.Token)
	if err != nil {
		log.Printf("[Forumline:TokenExchange] validation failed: %v", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}

	// Create or link local user
	identity := &model.ForumlineIdentity{
		ForumlineID: userInfo.ForumlineID,
		Username:    userInfo.Username,
		DisplayName: userInfo.DisplayName,
		AvatarURL:   userInfo.AvatarURL,
	}
	localUserID, err := h.createOrLinkUser(r, identity)
	if err != nil {
		log.Printf("[Forumline:TokenExchange] createOrLinkUser failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create profile"})
		return
	}

	// Return the access token and local user ID so the frontend can store them
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token":  req.Token,
		"local_user_id": localUserID,
		"user": map[string]string{
			"id":           userInfo.ForumlineID,
			"username":     userInfo.Username,
			"display_name": userInfo.DisplayName,
			"avatar_url":   userInfo.AvatarURL,
		},
	})
}

// HandleForumlineToken handles GET /api/forumline/auth/forumline-token.
func (h *Handlers) HandleForumlineToken(w http.ResponseWriter, r *http.Request) {
	cookies := parseCookies(r)
	localUserID := cookies["forumline_user_id"]

	if localUserID != "" {
		forumlineID, err := h.Store.GetForumlineID(r.Context(), localUserID)
		if err != nil {
			log.Printf("query forumline_id error: %v", err)
		}
		if forumlineID == nil || *forumlineID == "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{"forumline_access_token": nil})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"forumline_access_token": nil})
}

// HandleForumlineSession handles GET/DELETE /api/forumline/auth/session.
func (h *Handlers) HandleForumlineSession(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		h.handleDisconnect(w, r)
		return
	}

	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	cookies := parseCookies(r)
	localUserID := cookies["forumline_user_id"]
	if localUserID == "" {
		writeJSON(w, http.StatusOK, nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"local_user_id": localUserID,
	})
}

// handleDisconnect clears Forumline session cookies.
func (h *Handlers) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	clearCookie(w, "forumline_user_id")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Identity service integration ---

// idUserInfo is the response from the identity service.
type idUserInfo struct {
	ForumlineID string `json:"forumline_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	AccessToken string `json:"access_token"`
}

// exchangeAuthCode calls POST /token on the identity service to exchange
// an auth code for user info.
func (h *Handlers) exchangeAuthCode(r *http.Request, code, redirectURI string) (*idUserInfo, error) {
	body, _ := json.Marshal(map[string]string{
		"code":         code,
		"redirect_uri": redirectURI,
	})

	req, err := http.NewRequestWithContext(r.Context(), "POST", h.Config.IdentityURL+"/token", strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, &idError{Status: resp.StatusCode, Body: string(respBody)}
	}

	var info idUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
}

// validateForumlineToken calls GET /userinfo on the identity service to
// validate a Forumline JWT and get user profile info.
func (h *Handlers) validateForumlineToken(r *http.Request, token string) (*idUserInfo, error) {
	req, err := http.NewRequestWithContext(r.Context(), "GET", h.Config.IdentityURL+"/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, &idError{Status: resp.StatusCode, Body: string(respBody)}
	}

	var info idUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
}

type idError struct {
	Status int
	Body   string
}

func (e *idError) Error() string {
	return "identity service returned " + http.StatusText(e.Status) + ": " + e.Body
}

// createOrLinkUser creates or links a local user from a Forumline identity.
func (h *Handlers) createOrLinkUser(r *http.Request, identity *model.ForumlineIdentity) (string, error) {
	ctx := r.Context()

	existingID, err := h.Store.GetProfileIDByForumlineID(ctx, identity.ForumlineID)
	if err == nil && existingID != "" {
		_ = h.Store.UpdateDisplayNameAndAvatar(ctx, existingID, identity.DisplayName, identity.AvatarURL)
		return existingID, nil
	}

	if err := h.Store.CreateProfileHosted(ctx, identity); err != nil {
		return "", err
	}
	return identity.ForumlineID, nil
}

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "",
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1,
	})
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
