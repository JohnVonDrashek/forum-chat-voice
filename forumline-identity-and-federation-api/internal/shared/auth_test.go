package shared

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func setJWTSecret(t *testing.T, secret string) {
	t.Helper()
	t.Setenv("JWT_SECRET", secret)
}

func makeHMACToken(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

func TestValidateJWT_ValidHMAC(t *testing.T) {
	secret := "test-secret-for-jwt-validation-32chars"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub":   "user-123",
		"email": "test@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateJWT(tokenStr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if claims.Subject != "user-123" {
		t.Errorf("subject = %q, want %q", claims.Subject, "user-123")
	}
	if claims.Email != "test@example.com" {
		t.Errorf("email = %q, want %q", claims.Email, "test@example.com")
	}
}

func TestValidateJWT_ExpiredToken(t *testing.T) {
	secret := "test-secret-for-jwt-validation-32chars"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(-time.Hour).Unix(),
	})

	_, err := ValidateJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestValidateJWT_MalformedToken(t *testing.T) {
	setJWTSecret(t, "test-secret")

	_, err := ValidateJWT("not.a.valid.token")
	if err == nil {
		t.Fatal("expected error for malformed token")
	}
}

func TestValidateJWT_WrongSecret(t *testing.T) {
	setJWTSecret(t, "correct-secret-for-validation-32chars")

	tokenStr := makeHMACToken(t, "wrong-secret-for-validation-32chars", jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err := ValidateJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateJWT_MissingSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")

	tokenStr := makeHMACToken(t, "any-secret", jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err := ValidateJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error when JWT_SECRET is empty")
	}
}

func TestValidateJWT_UnsupportedSigningMethod(t *testing.T) {
	// none algorithm should be rejected
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

	_, err := ValidateJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error for none signing method")
	}
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	secret := "test-secret-for-middleware-test-32chars"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "user-abc",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var capturedUserID string
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "user-abc" {
		t.Errorf("userID = %q, want %q", capturedUserID, "user-abc")
	}
}

func TestAuthMiddleware_MissingToken(t *testing.T) {
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_InvalidToken(t *testing.T) {
	setJWTSecret(t, "test-secret")

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_NoSubject(t *testing.T) {
	secret := "test-secret-for-no-subject-test-32ch"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"email": "test@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_CookieToken(t *testing.T) {
	secret := "test-secret-for-cookie-test-32chars!"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "cookie-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var capturedUserID string
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.AddCookie(&http.Cookie{Name: "sb-access-token", Value: tokenStr})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "cookie-user" {
		t.Errorf("userID = %q, want %q", capturedUserID, "cookie-user")
	}
}

func TestAuthMiddleware_QueryParamToken(t *testing.T) {
	secret := "test-secret-for-query-param-test-32c"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "query-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var capturedUserID string
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test?access_token="+tokenStr, nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "query-user" {
		t.Errorf("userID = %q, want %q", capturedUserID, "query-user")
	}
}

func TestOptionalAuthMiddleware_WithToken(t *testing.T) {
	secret := "test-secret-for-optional-auth-32char"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "optional-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var capturedUserID string
	handler := OptionalAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "optional-user" {
		t.Errorf("userID = %q, want %q", capturedUserID, "optional-user")
	}
}

func TestOptionalAuthMiddleware_WithoutToken(t *testing.T) {
	var capturedUserID string
	handler := OptionalAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "" {
		t.Errorf("userID = %q, want empty", capturedUserID)
	}
}

func TestOptionalAuthMiddleware_InvalidToken(t *testing.T) {
	setJWTSecret(t, "test-secret")

	var capturedUserID string
	handler := OptionalAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer bad-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	// Should still pass through (optional), just no user in context
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if capturedUserID != "" {
		t.Errorf("userID = %q, want empty", capturedUserID)
	}
}

func TestUserIDFromContext_Empty(t *testing.T) {
	ctx := context.Background()
	if got := UserIDFromContext(ctx); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestUserIDFromContext_WithValue(t *testing.T) {
	ctx := context.WithValue(context.Background(), UserIDKey, "test-user")
	if got := UserIDFromContext(ctx); got != "test-user" {
		t.Errorf("got %q, want %q", got, "test-user")
	}
}

func TestExtractToken_Priority(t *testing.T) {
	// Authorization header should take priority over cookie and query param
	secret := "test-secret-for-extract-token-32char"
	t.Setenv("JWT_SECRET", secret)

	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test?access_token=query-token", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.AddCookie(&http.Cookie{Name: "sb-access-token", Value: "cookie-token"})

	got := extractToken(req)
	if got != "header-token" {
		t.Errorf("extractToken = %q, want %q (header should take priority)", got, "header-token")
	}
}

func TestExtractToken_CookieFallback(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test?access_token=query-token", nil)
	req.AddCookie(&http.Cookie{Name: "sb-access-token", Value: "cookie-token"})

	got := extractToken(req)
	if got != "cookie-token" {
		t.Errorf("extractToken = %q, want %q (cookie should be second priority)", got, "cookie-token")
	}
}

func TestExtractToken_QueryParamFallback(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(),"GET", "/test?access_token=query-token", nil)

	got := extractToken(req)
	if got != "query-token" {
		t.Errorf("extractToken = %q, want %q", got, "query-token")
	}
}
