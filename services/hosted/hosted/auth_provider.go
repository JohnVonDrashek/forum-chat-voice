package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/forum"
	"github.com/forumline/forumline/forum/model"
	"github.com/forumline/forumline/forum/store"
)

// ForumlineAuthProvider implements forum.AuthProvider using id.forumline.net
// as the identity service. This is the auth provider for hosted forums.
type ForumlineAuthProvider struct {
	IdentityURL string // e.g. "https://id.forumline.net"
	SiteURL     string // e.g. "https://testforum.forumline.net"
	Store       *store.Store
}

// Middleware returns the Zitadel JWT validation middleware.
// The identity service issues Zitadel JWTs, so we validate them directly.
func (p *ForumlineAuthProvider) Middleware() func(http.Handler) http.Handler {
	return auth.Middleware
}

// StartLogin handles GET /api/forumline/auth.
// Redirects to id.forumline.net to start the "Sign in with Forumline" flow.
func (p *ForumlineAuthProvider) StartLogin(w http.ResponseWriter, r *http.Request) {
	if p.IdentityURL == "" {
		writeJSONHelper(w, http.StatusServiceUnavailable, map[string]string{"error": "identity service not configured"})
		return
	}

	callbackURL := p.SiteURL + "/api/forumline/auth/callback"
	state := randomHexStr(16)

	http.SetCookie(w, &http.Cookie{
		Name: "forumline_state", Value: state,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
	})

	authorizeURL := p.IdentityURL + "/authorize?" + url.Values{
		"redirect_uri": {callbackURL},
		"state":        {state},
	}.Encode()

	http.Redirect(w, r, authorizeURL, http.StatusFound)
}

// HandleCallback handles GET /api/forumline/auth/callback.
// Receives an auth code from id.forumline.net, exchanges it for user info,
// and creates/links the local forum profile.
func (p *ForumlineAuthProvider) HandleCallback(w http.ResponseWriter, r *http.Request) {
	cookies := parseCookiesHelper(r)
	state := r.URL.Query().Get("state")
	if state == "" || cookies["forumline_state"] != state {
		writeJSONHelper(w, http.StatusBadRequest, map[string]string{"error": "state mismatch"})
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeJSONHelper(w, http.StatusBadRequest, map[string]string{"error": "missing auth code"})
		return
	}

	callbackURL := p.SiteURL + "/api/forumline/auth/callback"
	userInfo, err := p.exchangeAuthCode(r, code, callbackURL)
	if err != nil {
		log.Printf("[Forumline:Callback] token exchange failed: %v", err)
		http.Redirect(w, r, p.SiteURL+"/login?error=auth_failed", http.StatusFound)
		return
	}

	identity := &forum.UserIdentity{
		ProviderID:  userInfo.ForumlineID,
		Username:    userInfo.Username,
		DisplayName: userInfo.DisplayName,
		AvatarURL:   userInfo.AvatarURL,
	}
	localUserID, err := p.CreateOrLinkUser(r.Context(), identity)
	if err != nil {
		log.Printf("[Forumline:Callback] createOrLinkUser failed: %v", err)
		http.Redirect(w, r, p.SiteURL+"/login?error=auth_failed", http.StatusFound)
		return
	}

	clearCookieHelper(w, "forumline_state")

	http.SetCookie(w, &http.Cookie{
		Name: "forumline_user_id", Value: localUserID,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 3600,
	})

	accessToken := userInfo.AccessToken
	redirectURL := p.SiteURL + "/#access_token=" + url.QueryEscape(accessToken) + "&type=bearer"
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// TokenExchange handles POST /api/forumline/auth/token-exchange.
// Validates a JWT passed via postMessage from the Forumline app iframe.
func (p *ForumlineAuthProvider) TokenExchange(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		writeJSONHelper(w, http.StatusBadRequest, map[string]string{"error": "token is required"})
		return
	}

	userInfo, err := p.validateForumlineToken(r, req.Token)
	if err != nil {
		log.Printf("[Forumline:TokenExchange] validation failed: %v", err)
		writeJSONHelper(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}

	identity := &forum.UserIdentity{
		ProviderID:  userInfo.ForumlineID,
		Username:    userInfo.Username,
		DisplayName: userInfo.DisplayName,
		AvatarURL:   userInfo.AvatarURL,
	}
	localUserID, err := p.CreateOrLinkUser(r.Context(), identity)
	if err != nil {
		log.Printf("[Forumline:TokenExchange] createOrLinkUser failed: %v", err)
		writeJSONHelper(w, http.StatusInternalServerError, map[string]string{"error": "failed to create profile"})
		return
	}

	writeJSONHelper(w, http.StatusOK, map[string]interface{}{
		"access_token":  req.Token,
		"local_user_id": localUserID,
		"user": map[string]string{
			"id":           localUserID,
			"username":     userInfo.Username,
			"display_name": userInfo.DisplayName,
			"avatar_url":   userInfo.AvatarURL,
		},
	})
}

// GetSession handles GET /api/forumline/auth/session.
func (p *ForumlineAuthProvider) GetSession(w http.ResponseWriter, r *http.Request) {
	cookies := parseCookiesHelper(r)
	localUserID := cookies["forumline_user_id"]
	if localUserID == "" {
		writeJSONHelper(w, http.StatusOK, nil)
		return
	}

	writeJSONHelper(w, http.StatusOK, map[string]interface{}{
		"local_user_id": localUserID,
	})
}

// Logout handles DELETE /api/forumline/auth/session.
func (p *ForumlineAuthProvider) Logout(w http.ResponseWriter, r *http.Request) {
	clearCookieHelper(w, "forumline_user_id")
	writeJSONHelper(w, http.StatusOK, map[string]bool{"ok": true})
}

// CreateOrLinkUser creates a local forum profile for the given identity,
// or links to an existing profile if the provider ID is already known.
func (p *ForumlineAuthProvider) CreateOrLinkUser(ctx context.Context, identity *forum.UserIdentity) (string, error) {
	existingID, err := p.Store.GetProfileIDByForumlineID(ctx, identity.ProviderID)
	if err == nil && existingID != "" {
		_ = p.Store.UpdateDisplayNameAndAvatar(ctx, existingID, identity.DisplayName, identity.AvatarURL)
		return existingID, nil
	}

	fIdentity := &model.ForumlineIdentity{
		ForumlineID: identity.ProviderID,
		Username:    identity.Username,
		DisplayName: identity.DisplayName,
		AvatarURL:   identity.AvatarURL,
	}
	localID, err := p.Store.CreateProfileHosted(ctx, fIdentity)
	if err != nil {
		return "", err
	}
	return localID, nil
}

// --- Identity service integration ---

type idUserInfo struct {
	ForumlineID string `json:"forumline_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	AccessToken string `json:"access_token"`
}

func (p *ForumlineAuthProvider) exchangeAuthCode(r *http.Request, code, redirectURI string) (*idUserInfo, error) {
	body, _ := json.Marshal(map[string]string{
		"code":         code,
		"redirect_uri": redirectURI,
	})

	req, err := http.NewRequestWithContext(r.Context(), "POST", p.IdentityURL+"/token", strings.NewReader(string(body)))
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

func (p *ForumlineAuthProvider) validateForumlineToken(r *http.Request, token string) (*idUserInfo, error) {
	req, err := http.NewRequestWithContext(r.Context(), "GET", p.IdentityURL+"/userinfo", nil)
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

// --- Helpers (local to main package) ---

func writeJSONHelper(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json encode error: %v", err)
	}
}

func parseCookiesHelper(r *http.Request) map[string]string {
	cookies := make(map[string]string)
	for _, c := range r.Cookies() {
		cookies[c.Name] = c.Value
	}
	return cookies
}

func clearCookieHelper(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "",
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1,
	})
}

func randomHexStr(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
