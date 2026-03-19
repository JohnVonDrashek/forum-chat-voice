// Forumline Identity Service (id.forumline.net)
//
// A lightweight OAuth proxy that wraps Zitadel, presenting a "Sign in with
// Forumline" API to all forums (hosted and self-hosted). Forums never talk
// to Zitadel directly — they redirect here, and this service handles the
// OIDC dance behind the scenes.
//
// Endpoints are defined in openapi.yaml and routed via oapi-codegen.
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

	"github.com/go-chi/chi/v5"

	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-id/oapi"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	httphelper "github.com/zitadel/oidc/v3/pkg/http"
)

// Server implements oapi.StrictServerInterface — all 6 identity service endpoints.
type Server struct {
	provider    rp.RelyingParty
	codes       *codeStore
	jwks        *jwksCache
	userinfoURL string
}

// Compile-time check that Server implements the generated strict interface.
var _ oapi.StrictServerInterface = (*Server)(nil)

// authCode is a short-lived, single-use authorization code issued after
// successful Zitadel login. Forums exchange it for user info via POST /token.
type authCode struct {
	UserInfo    *oapi.UserInfo
	RedirectURI string
	ExpiresAt   time.Time
}

// codeStore is an in-memory store for auth codes with automatic expiry.
type codeStore struct {
	mu    sync.Mutex
	codes map[string]*authCode
}

func newCodeStore() *codeStore {
	cs := &codeStore{codes: make(map[string]*authCode)}
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

func (cs *codeStore) Consume(code, redirectURI string) (*authCode, bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	ac, ok := cs.codes[code]
	if !ok || time.Now().After(ac.ExpiresAt) {
		delete(cs.codes, code)
		return nil, false
	}
	if ac.RedirectURI != redirectURI {
		delete(cs.codes, code) // invalidate on any failed attempt (RFC 6749 §4.1.2)
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
	url       string
}

// ── Custom response types ────────────────────────────────────────────────────

// authorizeRedirect sets two cookies and performs a 302 redirect to Zitadel.
// The generated Authorize302Response only supports a single Set-Cookie header,
// so we implement AuthorizeResponseObject directly.
type authorizeRedirect struct {
	authURL   string
	forumCtx  string
	oidcState string
}

func (r authorizeRedirect) VisitAuthorizeResponse(w http.ResponseWriter) error {
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_id_ctx", Value: r.forumCtx,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
	})
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_id_state", Value: r.oidcState,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: 600,
	})
	w.Header().Set("Location", r.authURL)
	w.WriteHeader(http.StatusFound)
	return nil
}

// callbackRedirect clears both auth cookies and performs a 302 redirect to the forum.
// The generated Callback302Response doesn't include cookie clearing.
type callbackRedirect struct{ location string }

func (r callbackRedirect) VisitCallbackResponse(w http.ResponseWriter) error {
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_id_state", Value: "",
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1,
	})
	http.SetCookie(w, &http.Cookie{
		Name: "forumline_id_ctx", Value: "",
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true, MaxAge: -1,
	})
	w.Header().Set("Location", r.location)
	w.WriteHeader(http.StatusFound)
	return nil
}

// jwksRaw writes pre-fetched JWKS bytes directly, bypassing JSON re-encoding.
// The generated Jwks200JSONResponse would require parsing the bytes back into
// a JWKS struct, which is unnecessary overhead.
type jwksRaw struct{ data []byte }

func (r jwksRaw) VisitJwksResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(200)
	_, err := w.Write(r.data)
	return err
}

// ── Context key for request injection ───────────────────────────────────────

type httpReqKey struct{}

// injectRequest stores the *http.Request in the context so strict handler
// methods can access cookies and headers (not available via StrictServerInterface params).
func injectRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), httpReqKey{}, r)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ── StrictServerInterface implementation ────────────────────────────────────

func (s *Server) HealthCheck(_ context.Context, _ oapi.HealthCheckRequestObject) (oapi.HealthCheckResponseObject, error) {
	return oapi.HealthCheck200JSONResponse{Status: "ok"}, nil
}

func (s *Server) Authorize(_ context.Context, request oapi.AuthorizeRequestObject) (oapi.AuthorizeResponseObject, error) {
	redirectURI := request.Params.RedirectUri
	var forumState string
	if request.Params.State != nil {
		forumState = *request.Params.State
	}

	// Validate redirect_uri is a *.forumline.net domain or localhost (dev)
	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Host == "" {
		return oapi.Authorize400JSONResponse{Error: "invalid redirect_uri"}, nil
	}
	if !isAllowedRedirect(parsed) {
		return oapi.Authorize400JSONResponse{Error: "redirect_uri must be a *.forumline.net domain"}, nil
	}

	// Store forum context in a cookie (survives the Zitadel redirect)
	forumCtx := redirectURI + "|" + forumState

	// Generate OIDC state and redirect to Zitadel
	oidcState := randomHex(16)
	authURL := rp.AuthURL(oidcState, s.provider)

	return authorizeRedirect{
		authURL:   authURL,
		forumCtx:  forumCtx,
		oidcState: oidcState,
	}, nil
}

func (s *Server) Callback(ctx context.Context, request oapi.CallbackRequestObject) (oapi.CallbackResponseObject, error) {
	// Retrieve *http.Request from context to read cookies
	r := ctx.Value(httpReqKey{}).(*http.Request)

	// Validate OIDC state
	stateCookie, err := r.Cookie("forumline_id_state")
	if err != nil || stateCookie.Value != request.Params.State {
		return oapi.Callback400JSONResponse{Error: "state mismatch"}, nil
	}

	// Retrieve forum context
	ctxCookie, err := r.Cookie("forumline_id_ctx")
	if err != nil {
		return oapi.Callback400JSONResponse{Error: "missing forum context"}, nil
	}
	parts := strings.SplitN(ctxCookie.Value, "|", 2)
	if len(parts) != 2 {
		return oapi.Callback400JSONResponse{Error: "invalid forum context"}, nil
	}
	forumRedirectURI := parts[0]
	forumState := parts[1]

	// Exchange code for tokens with Zitadel
	tokens, err := rp.CodeExchange[*oidc.IDTokenClaims](r.Context(), request.Params.Code, s.provider)
	if err != nil {
		slog.Error("OIDC code exchange failed", "error", err)
		return oapi.Callback500JSONResponse{Error: "authentication failed"}, nil
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

	userInfo := &oapi.UserInfo{
		ForumlineId: claims.Subject,
		Username:    username,
		DisplayName: displayName,
		AvatarUrl:   claims.Picture,
		AccessToken: tokens.AccessToken,
	}

	// Generate short-lived auth code
	code := randomHex(32)
	s.codes.Store(code, &authCode{
		UserInfo:    userInfo,
		RedirectURI: forumRedirectURI,
		ExpiresAt:   time.Now().Add(60 * time.Second),
	})

	// Redirect back to forum with auth code (cookies cleared by callbackRedirect)
	u, _ := url.Parse(forumRedirectURI)
	q := u.Query()
	q.Set("code", code)
	if forumState != "" {
		q.Set("state", forumState)
	}
	u.RawQuery = q.Encode()

	return callbackRedirect{location: u.String()}, nil
}

func (s *Server) TokenExchange(_ context.Context, request oapi.TokenExchangeRequestObject) (oapi.TokenExchangeResponseObject, error) {
	if request.Body == nil || request.Body.Code == "" || request.Body.RedirectUri == "" {
		return oapi.TokenExchange400JSONResponse{Error: "code and redirect_uri are required"}, nil
	}

	ac, ok := s.codes.Consume(request.Body.Code, request.Body.RedirectUri)
	if !ok {
		return oapi.TokenExchange401JSONResponse{Error: "invalid or expired code"}, nil
	}

	return oapi.TokenExchange200JSONResponse(*ac.UserInfo), nil
}

func (s *Server) UserInfo(ctx context.Context, request oapi.UserInfoRequestObject) (oapi.UserInfoResponseObject, error) {
	// Retrieve *http.Request from context to support Authorization header bearer token
	r := ctx.Value(httpReqKey{}).(*http.Request)
	token := extractBearerToken(r)
	if token == "" {
		return oapi.UserInfo401JSONResponse{Error: "missing bearer token"}, nil
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", s.userinfoURL, nil)
	if err != nil {
		return oapi.UserInfo502JSONResponse{Error: "failed to build userinfo request"}, nil
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("userinfo failed", "error", err)
		return oapi.UserInfo502JSONResponse{Error: "identity provider unreachable"}, nil
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return oapi.UserInfo401JSONResponse{Error: "invalid or expired token"}, nil
	}

	var result struct {
		Sub              string `json:"sub"`
		Name             string `json:"name"`
		GivenName        string `json:"given_name"`
		FamilyName       string `json:"family_name"`
		PreferredUsername string `json:"preferred_username"`
		Email            string `json:"email"`
		Picture          string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.Sub == "" {
		return oapi.UserInfo401JSONResponse{Error: "invalid or expired token"}, nil
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

	return oapi.UserInfo200JSONResponse{
		ForumlineId: result.Sub,
		Username:    username,
		DisplayName: displayName,
		AvatarUrl:   result.Picture,
	}, nil
}

func (s *Server) Jwks(_ context.Context, _ oapi.JwksRequestObject) (oapi.JwksResponseObject, error) {
	s.jwks.mu.RLock()
	if s.jwks.data != nil && time.Since(s.jwks.fetchedAt) < s.jwks.ttl {
		data := s.jwks.data
		s.jwks.mu.RUnlock()
		return jwksRaw{data: data}, nil
	}
	s.jwks.mu.RUnlock()

	resp, err := http.Get(s.jwks.url) // #nosec G107 -- zitadelURL is from trusted env var
	if err != nil {
		slog.Error("JWKS fetch failed", "error", err)
		return oapi.Jwks502JSONResponse{Error: "identity provider unreachable"}, nil
	}
	defer func() { _ = resp.Body.Close() }()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return oapi.Jwks502JSONResponse{Error: "failed to read JWKS"}, nil
	}

	s.jwks.mu.Lock()
	s.jwks.data = data
	s.jwks.fetchedAt = time.Now()
	s.jwks.mu.Unlock()

	return jwksRaw{data: data}, nil
}

// ── main ────────────────────────────────────────────────────────────────────

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

	server := &Server{
		provider:    provider,
		codes:       newCodeStore(),
		userinfoURL: strings.TrimRight(zitadelURL, "/") + "/oidc/v1/userinfo",
		jwks: &jwksCache{
			ttl: 5 * time.Minute,
			url: strings.TrimRight(zitadelURL, "/") + "/oauth/v2/keys",
		},
	}

	r := chi.NewRouter()
	r.Use(httpkit.SecurityHeaders)
	r.Use(httpkit.CORSMiddleware)
	r.Use(injectRequest)

	// oapi-codegen routes use a stdlib mux (pattern syntax: "METHOD /path")
	mux := http.NewServeMux()
	strictHandler := oapi.NewStrictHandler(server, nil)
	oapi.HandlerFromMux(strictHandler, mux)
	r.Mount("/", mux)

	var handler http.Handler = r

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

// ── Helpers ─────────────────────────────────────────────────────────────────

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
