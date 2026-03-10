package shared

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCORSMiddleware_ExactMatch(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net,https://demo.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Origin", "https://demo.forumline.net")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://demo.forumline.net" {
		t.Errorf("Allow-Origin = %q, want %q", got, "https://demo.forumline.net")
	}
}

func TestCORSMiddleware_WildcardSubdomain(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://*.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tests := []struct {
		origin  string
		allowed bool
	}{
		{"https://myforum.forumline.net", true},
		{"https://app.forumline.net", true},
		{"https://evil.com", false},
		{"https://sub.nested.forumline.net", false}, // nested subdomain
		{"http://myforum.forumline.net", false},     // wrong scheme
	}

	for _, tt := range tests {
		t.Run(tt.origin, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
			req.Header.Set("Origin", tt.origin)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			got := rr.Header().Get("Access-Control-Allow-Origin")
			if tt.allowed && got != tt.origin {
				t.Errorf("Allow-Origin = %q, want %q", got, tt.origin)
			}
			if !tt.allowed && got != "" {
				t.Errorf("Allow-Origin = %q, want empty", got)
			}
		})
	}
}

func TestCORSMiddleware_DisallowedOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Origin", "https://evil.com")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin = %q, want empty", got)
	}
	// Request should still proceed (just without CORS headers)
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestCORSMiddleware_Preflight(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.forumline.net")

	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called for OPTIONS")
	}))

	req := httptest.NewRequestWithContext(context.Background(),"OPTIONS", "/test", nil)
	req.Header.Set("Origin", "https://app.forumline.net")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
	if got := rr.Header().Get("Access-Control-Max-Age"); got != "86400" {
		t.Errorf("Max-Age = %q, want %q", got, "86400")
	}
}

func TestSecurityHeaders(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	expected := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":       "DENY",
		"X-XSS-Protection":      "1; mode=block",
	}
	for header, want := range expected {
		if got := rr.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestRateLimiter_BasicLimiting(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    3,
		window:   time.Minute,
	}

	for i := 0; i < 3; i++ {
		if !rl.Allow("192.168.1.1") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if rl.Allow("192.168.1.1") {
		t.Fatal("4th request should be rejected")
	}
}

func TestRateLimiter_DifferentIPs(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	if !rl.Allow("10.0.0.1") {
		t.Fatal("first IP should be allowed")
	}
	if !rl.Allow("10.0.0.2") {
		t.Fatal("different IP should be allowed")
	}
}

func TestRateLimiter_WindowExpiry(t *testing.T) {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   10 * time.Millisecond,
	}

	rl.Allow("1.1.1.1")
	if rl.Allow("1.1.1.1") {
		t.Fatal("should be rate limited")
	}

	time.Sleep(15 * time.Millisecond)
	if !rl.Allow("1.1.1.1") {
		t.Fatal("should be allowed after window expires")
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
		t.Fatal("expired entry should be cleaned up")
	}
}

func TestRateLimitMiddleware_TrustProxy(t *testing.T) {
	t.Setenv("TRUST_PROXY", "true")

	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	handler := RateLimitMiddleware(rl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request allowed
	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.50")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("first: status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Second request from same forwarded IP rate limited
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("second: status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
}

func TestRateLimitMiddleware_NoTrustProxy(t *testing.T) {
	t.Setenv("TRUST_PROXY", "false")

	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1,
		window:   time.Minute,
	}

	handler := RateLimitMiddleware(rl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// With TRUST_PROXY=false, X-Forwarded-For should be ignored
	req1 := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req1.RemoteAddr = "10.0.0.1:1234"
	req1.Header.Set("X-Forwarded-For", "203.0.113.50")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req1)
	if rr.Code != http.StatusOK {
		t.Errorf("first: status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Second request with same RemoteAddr but different X-Forwarded-For
	req2 := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req2.RemoteAddr = "10.0.0.1:1234"
	req2.Header.Set("X-Forwarded-For", "203.0.113.99")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req2)
	// Should be limited because RemoteAddr is the same (ignoring X-Forwarded-For)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("second: status = %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
}
