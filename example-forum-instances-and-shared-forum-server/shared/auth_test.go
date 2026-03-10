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

func TestValidateJWT_Valid(t *testing.T) {
	secret := "test-secret-for-jwt-validation-32chars"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub":   "user-123",
		"email": "user@test.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateJWT(tokenStr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if claims.Subject != "user-123" {
		t.Errorf("subject = %q, want %q", claims.Subject, "user-123")
	}
}

func TestValidateJWT_Expired(t *testing.T) {
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

func TestValidateJWT_WrongSecret(t *testing.T) {
	setJWTSecret(t, "correct-secret-32chars-for-testing!")

	tokenStr := makeHMACToken(t, "wrong-secret-32chars-for-testing!", jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err := ValidateJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateJWT_Malformed(t *testing.T) {
	setJWTSecret(t, "test-secret")

	_, err := ValidateJWT("garbage")
	if err == nil {
		t.Fatal("expected error for malformed token")
	}
}

func TestAuthMiddleware_ValidBearer(t *testing.T) {
	secret := "test-secret-for-auth-middleware-32ch"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "user-456",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var gotUserID string
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if gotUserID != "user-456" {
		t.Errorf("userID = %q, want %q", gotUserID, "user-456")
	}
}

func TestAuthMiddleware_MissingAuth(t *testing.T) {
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach handler")
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_CookieAuth(t *testing.T) {
	secret := "test-secret-for-cookie-auth-32chars!"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "cookie-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var gotUserID string
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: "sb-access-token", Value: tokenStr})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if gotUserID != "cookie-user" {
		t.Errorf("userID = %q, want %q", gotUserID, "cookie-user")
	}
}

func TestOptionalAuthMiddleware_WithToken(t *testing.T) {
	secret := "test-secret-for-optional-auth-32char"
	setJWTSecret(t, secret)

	tokenStr := makeHMACToken(t, secret, jwt.MapClaims{
		"sub": "opt-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	var gotUserID string
	handler := OptionalAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if gotUserID != "opt-user" {
		t.Errorf("userID = %q, want %q", gotUserID, "opt-user")
	}
}

func TestOptionalAuthMiddleware_WithoutToken(t *testing.T) {
	var gotUserID string
	handler := OptionalAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if gotUserID != "" {
		t.Errorf("userID = %q, want empty", gotUserID)
	}
}

func TestUserIDFromContext(t *testing.T) {
	if got := UserIDFromContext(context.Background()); got != "" {
		t.Errorf("empty context: got %q, want empty", got)
	}

	ctx := context.WithValue(context.Background(), UserIDKey, "test-id")
	if got := UserIDFromContext(ctx); got != "test-id" {
		t.Errorf("got %q, want %q", got, "test-id")
	}
}
