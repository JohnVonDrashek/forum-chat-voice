package shared

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCORSMiddleware_AllowedOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net,https://demo.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "https://app.forumline.net")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://app.forumline.net" {
		t.Errorf("Allow-Origin = %q, want %q", got, "https://app.forumline.net")
	}
	if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want %q", got, "true")
	}
}

func TestCORSMiddleware_DisallowedOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "https://evil.com")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin = %q, want empty", got)
	}
}

func TestCORSMiddleware_DefaultOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "https://demo.forumline.net")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://demo.forumline.net" {
		t.Errorf("Allow-Origin = %q, want %q", got, "https://demo.forumline.net")
	}
}

func TestCORSMiddleware_OptionsRequest(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called for OPTIONS")
	}))

	req := httptest.NewRequest("OPTIONS", "/test", nil)
	req.Header.Set("Origin", "https://app.forumline.net")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestSecurityHeaders(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	tests := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":       "DENY",
		"X-XSS-Protection":      "1; mode=block",
	}
	for header, want := range tests {
		if got := rr.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestRateLimiter_Allow(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    3,
		window:   time.Minute,
	}

	for i := 0; i < 3; i++ {
		if !rl.Allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}

	if rl.Allow("1.2.3.4") {
		t.Fatal("4th request should be rate limited")
	}
}

func TestRateLimiter_DifferentIPs(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	if !rl.Allow("1.1.1.1") {
		t.Fatal("first IP should be allowed")
	}
	if !rl.Allow("2.2.2.2") {
		t.Fatal("second IP should be allowed")
	}
	if rl.Allow("1.1.1.1") {
		t.Fatal("first IP should be rate limited")
	}
}

func TestRateLimiter_WindowExpiry(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   10 * time.Millisecond,
	}

	if !rl.Allow("1.1.1.1") {
		t.Fatal("first request should be allowed")
	}
	if rl.Allow("1.1.1.1") {
		t.Fatal("second request should be rate limited")
	}

	time.Sleep(15 * time.Millisecond)

	if !rl.Allow("1.1.1.1") {
		t.Fatal("request after window should be allowed")
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   10 * time.Millisecond,
	}

	rl.Allow("1.1.1.1")
	time.Sleep(15 * time.Millisecond)
	rl.cleanup()

	rl.mu.Lock()
	_, exists := rl.requests["1.1.1.1"]
	rl.mu.Unlock()

	if exists {
		t.Fatal("expired entries should be cleaned up")
	}
}

func TestRateLimitMiddleware_Blocks(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	handler := RateLimitMiddleware(rl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request succeeds
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("first request: status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Second request rate limited
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("second request: status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
}

func TestRateLimitMiddleware_XForwardedFor(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	handler := RateLimitMiddleware(rl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Forumline API middleware always trusts X-Forwarded-For
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.1, 10.0.0.1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("first request: status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Second request with same forwarded IP
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("second request: status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
}
