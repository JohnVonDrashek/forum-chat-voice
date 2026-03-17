// Forumline Identity Service (id.forumline.net)
//
// A lightweight OAuth proxy that wraps Zitadel, presenting a "Sign in with
// Forumline" API to all forums (hosted and self-hosted). Forums never talk
// to Zitadel directly — they redirect here, and this service handles the
// OIDC dance behind the scenes.
//
// Endpoints:
//   GET  /authorize          — Forum redirects users here to start login
//   GET  /callback           — Zitadel redirects back here after login
//   POST /token              — Forum exchanges auth code for user info
//   GET  /userinfo           — Validate JWT and return user profile
//   GET  /.well-known/jwks   — Proxy Zitadel's JWKS for direct JWT validation
//   GET  /health             — Health check
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/forumline/forumline/backend/httpkit"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	httphelper "github.com/zitadel/oidc/v3/pkg/http"
)

// authCode is a short-lived, single-use authorization code issued after
// successful Zitadel login. Forums exchange it for user info via POST /token.
type authCode struct {
	UserInfo    *UserInfo
	RedirectURI string
	ExpiresAt   time.Time
}

// UserInfo is the identity payload returned to forums after auth code exchange.
type UserInfo struct {
	ForumlineID string `json:"forumline_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	AccessToken string `json:"access_token"`
}

// codeStore is an in-memory store for auth codes with automatic expiry.
type codeStore struct {
	mu    sync.Mutex
	codes map[string]*authCode
}

func newCodeStore() *codeStore {
	cs := &codeStore{codes: make(map[string]*authCode)}
	// Sweep expired codes every 30 seconds
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			cs.mu.Lock()
			now := time.Now()
			for k, v := range cs.codes {
				if now.After(v.ExpiresAt) {
					delete(cs.codes, k)
				}
			}
			cs.mu.Unlock()
		}
	}()
	return cs
}

func (cs *codeStore) Store(code string, ac *authCode) {
	cs.mu.Lock()
	cs.codes[code] = ac
	cs.mu.Unlock()
}

// Consume retrieves and deletes an auth code (single-use).
func (cs *codeStore) Consume(code, redirectURI string) (*authCode, bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	ac, ok := cs.codes[code]
	if !ok || time.Now().After(ac.ExpiresAt) {
		delete(cs.codes, code)
		return nil, false
	}
	if ac.RedirectURI != redirectURI {
		return nil, false
	}
	delete(cs.codes, code)
	return ac, true
}

// JWKS cache to avoid hammering Zitadel on every request.
type jwksCache struct {
	mu        sync.RWMutex
	data      []byte
	fetchedAt time.Time
	ttl       time.Duration
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	zitadelURL := requireEnv("ZITADEL_URL")
	clientID := requireEnv("ZITADEL_CLIENT_ID")
	clientSecret := os.Getenv("ZITADEL_CLIENT_SECRET") // optional for public clients
	externalURL := requireEnv("EXTERNAL_URL")           // https://id.forumline.net

	// Initialize OIDC relying party (this service is the Zitadel client)
	redirectURI := externalURL + "/callback"
	hashKey := []byte("forumline-id-oidc-pkce-hash-32b!")
	cookieHandler := httphelper.NewCookieHandler(hashKey, nil)
	opts := []rp.Option{rp.WithPKCE(cookieHandler)}

	provider, err := rp.NewRelyingPartyOIDC(ctx, zitadelURL, clientID, clientSecret, redirectURI,
		[]string{"openid", "profile", "email"}, opts...)
	if err != nil {
		log.Fatalf("failed to initialize OIDC provider: %v", err)
	}
	slog.Info("OIDC provider initialized", "issuer", zitadelURL, "client_id", clientID)

	codes := newCodeStore()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("GET /authorize", handleAuthorize(provider, externalURL))
	mux.HandleFunc("GET /callback", handleCallback(provider, codes))
	mux.HandleFunc("POST /token", handleTokenExchange(codes))
	mux.HandleFunc("GET /userinfo", handleUserInfo(zitadelURL, clientID))
	mux.HandleFunc("GET /.well-known/jwks", handleJWKS(zitadelURL))

	var handler http.Handler = mux
	handler = httpkit.CORSMiddleware(handler)
	handler = httpkit.SecurityHeaders(handler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down...")
		cancel()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown error", "error", err)
		}
	}()

	slog.Info("forumline-id listening", "port", port, "external_url", externalURL)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

// handleAuthorize starts the "Sign in with Forumline" flow.
// Forums redirect users here with:
//   ?redirect_uri=https://testforum.forumline.net/api/forumline/auth/callback
//   &state=<forum_csrf_state>
//
// We store the forum's redirect_uri + state in a cookie, then redirect to Zitadel.
func handleAuthorize(provider rp.RelyingParty, externalURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		redirectURI := r.URL.Query().Get("redirect_uri")
		forumState := r.URL.Query().Get("state")

		if redirectURI == "" {
			writeErr(w, http.StatusBadRequest, "redirect_uri is required")
			return
		}

		// Validate redirect_uri is a *.forumline.net domain or localhost (dev)
		parsed, err := url.Parse(redirectURI)
		if err != nil || parsed.Host == "" {
			writeErr(w, http.StatusBadRequest, "invalid redirect_uri")
			return
		}
		if !isAllowedRedirect(parsed) {
			writeErr(w, http.StatusBadRequest, "redirect_uri must be a *.forumline.net domain")
			return
		}

		// Store forum context in a cookie (survives the Zitadel redirect)
		forumCtx := redirectURI + "|" + forumState
		http.SetCookie(w, &http.Cookie{
			Name: "forumline_id_ctx", Value: forumCtx,
			Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
		})

		// Generate OIDC state and redirect to Zitadel
		oidcState := randomHex(16)
		http.SetCookie(w, &http.Cookie{
			Name: "forumline_id_state", Value: oidcState,
			Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
		})

		authURL := rp.AuthURL(oidcState, provider)
		http.Redirect(w, r, authURL, http.StatusFound)
	}
}

// handleCallback receives the Zitadel OIDC callback after successful login.
// Exchanges the code for tokens, generates a short-lived auth code, and
// redirects back to the forum's callback URL.
func handleCallback(provider rp.RelyingParty, codes *codeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate OIDC state
		stateCookie, err := r.Cookie("forumline_id_state")
		if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
			writeErr(w, http.StatusBadRequest, "state mismatch")
			return
		}

		// Retrieve forum context
		ctxCookie, err := r.Cookie("forumline_id_ctx")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "missing forum context")
			return
		}
		parts := strings.SplitN(ctxCookie.Value, "|", 2)
		if len(parts) != 2 {
			writeErr(w, http.StatusBadRequest, "invalid forum context")
			return
		}
		forumRedirectURI := parts[0]
		forumState := parts[1]

		// Exchange code for tokens with Zitadel
		tokens, err := rp.CodeExchange[*oidc.IDTokenClaims](r.Context(), r.URL.Query().Get("code"), provider)
		if err != nil {
			slog.Error("OIDC code exchange failed", "error", err)
			writeErr(w, http.StatusInternalServerError, "authentication failed")
			return
		}

		// Extract identity from ID token
		claims := tokens.IDTokenClaims
		username := claims.PreferredUsername
		if username == "" {
			username = string(claims.Email)
		}
		displayName := strings.TrimSpace(claims.GivenName + " " + claims.FamilyName)
		if displayName == "" {
			displayName = username
		}

		userInfo := &UserInfo{
			ForumlineID: claims.Subject,
			Username:    username,
			DisplayName: displayName,
			AvatarURL:   claims.Picture,
			AccessToken: tokens.AccessToken,
		}

		// Generate short-lived auth code
		code := randomHex(32)
		codes.Store(code, &authCode{
			UserInfo:    userInfo,
			RedirectURI: forumRedirectURI,
			ExpiresAt:   time.Now().Add(60 * time.Second),
		})

		// Clear cookies
		clearCookie(w, "forumline_id_state")
		clearCookie(w, "forumline_id_ctx")

		// Redirect back to forum with auth code
		u, _ := url.Parse(forumRedirectURI)
		q := u.Query()
		q.Set("code", code)
		if forumState != "" {
			q.Set("state", forumState)
		}
		u.RawQuery = q.Encode()

		http.Redirect(w, r, u.String(), http.StatusFound)
	}
}

// handleTokenExchange lets forums exchange an auth code for user info.
// This is the server-to-server call — the forum backend calls this after
// receiving the auth code in the callback redirect.
//
// POST /token
// Body: { "code": "...", "redirect_uri": "..." }
// Returns: { "forumline_id": "...", "username": "...", ... }
func handleTokenExchange(codes *codeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Code        string `json:"code"`
			RedirectURI string `json:"redirect_uri"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.Code == "" || req.RedirectURI == "" {
			writeErr(w, http.StatusBadRequest, "code and redirect_uri are required")
			return
		}

		ac, ok := codes.Consume(req.Code, req.RedirectURI)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "invalid or expired code")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ac.UserInfo)
	}
}

// handleUserInfo validates a Forumline JWT and returns user profile info.
// Forums can call this to verify a token passed via iframe (in-app flow).
//
// GET /userinfo
// Header: Authorization: Bearer <JWT>
// Returns: { "forumline_id": "...", "username": "...", ... }
func handleUserInfo(zitadelURL, _ string) http.HandlerFunc {
	userinfoURL := strings.TrimRight(zitadelURL, "/") + "/oidc/v1/userinfo"

	return func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			writeErr(w, http.StatusUnauthorized, "missing bearer token")
			return
		}

		// Validate token via Zitadel's userinfo endpoint (works with public clients,
		// unlike introspection which requires client authentication).
		req, err := http.NewRequestWithContext(r.Context(), "GET", userinfoURL, nil)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to build userinfo request")
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			slog.Error("userinfo failed", "error", err)
			writeErr(w, http.StatusBadGateway, "identity provider unreachable")
			return
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			writeErr(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		var result struct {
			Sub               string `json:"sub"`
			Name              string `json:"name"`
			GivenName         string `json:"given_name"`
			FamilyName        string `json:"family_name"`
			PreferredUsername  string `json:"preferred_username"`
			Email             string `json:"email"`
			Picture           string `json:"picture"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.Sub == "" {
			writeErr(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		displayName := strings.TrimSpace(result.GivenName + " " + result.FamilyName)
		if displayName == "" {
			displayName = result.Name
		}
		username := result.PreferredUsername
		if username == "" {
			username = result.Email
		}
		if displayName == "" {
			displayName = username
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(&UserInfo{
			ForumlineID: result.Sub,
			Username:    username,
			DisplayName: displayName,
			AvatarURL:   result.Picture,
		})
	}
}

// handleJWKS proxies Zitadel's JWKS endpoint so forums can validate JWTs
// directly without knowing Zitadel exists. Cached for 5 minutes.
func handleJWKS(zitadelURL string) http.HandlerFunc {
	cache := &jwksCache{ttl: 5 * time.Minute}
	jwksURL := strings.TrimRight(zitadelURL, "/") + "/oauth/v2/keys"

	return func(w http.ResponseWriter, r *http.Request) {
		cache.mu.RLock()
		if cache.data != nil && time.Since(cache.fetchedAt) < cache.ttl {
			data := cache.data
			cache.mu.RUnlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=300")
			_, _ = w.Write(data)
			return
		}
		cache.mu.RUnlock()

		resp, err := http.Get(jwksURL) // #nosec G107 -- zitadelURL is from trusted env var
		if err != nil {
			slog.Error("JWKS fetch failed", "error", err)
			writeErr(w, http.StatusBadGateway, "identity provider unreachable")
			return
		}
		defer func() { _ = resp.Body.Close() }()

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "failed to read JWKS")
			return
		}

		cache.mu.Lock()
		cache.data = data
		cache.fetchedAt = time.Now()
		cache.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = w.Write(data)
	}
}

// isAllowedRedirect checks that the redirect_uri is a trusted domain.
// Allows *.forumline.net and localhost (for development).
func isAllowedRedirect(u *url.URL) bool {
	host := u.Hostname()
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	return strings.HasSuffix(host, ".forumline.net") || host == "forumline.net"
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return r.URL.Query().Get("access_token")
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
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

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
	}
	return v
}
