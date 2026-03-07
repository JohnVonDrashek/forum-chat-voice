package shared

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "userID"

// Claims represents the JWT claims from GoTrue tokens.
type Claims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
}

// jwksCache caches the JWKS public keys fetched from GoTrue.
var (
	jwksMu     sync.RWMutex
	jwksKeys   map[string]*ecdsa.PublicKey
	jwksFetched time.Time
)

// ValidateJWT verifies a GoTrue-issued JWT and returns the claims.
// Supports both HMAC (standalone GoTrue) and ES256 (Supabase hosted).
func ValidateJWT(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, keyFunc)
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func keyFunc(t *jwt.Token) (interface{}, error) {
	switch t.Method.(type) {
	case *jwt.SigningMethodHMAC:
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			return nil, fmt.Errorf("JWT_SECRET is not set")
		}
		return []byte(secret), nil

	case *jwt.SigningMethodECDSA:
		kid, _ := t.Header["kid"].(string)
		key, err := getECDSAKey(kid)
		if err != nil {
			return nil, err
		}
		return key, nil

	default:
		return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
	}
}

// getECDSAKey returns the ECDSA public key for the given kid from the JWKS cache.
func getECDSAKey(kid string) (*ecdsa.PublicKey, error) {
	jwksMu.RLock()
	if jwksKeys != nil && time.Since(jwksFetched) < 10*time.Minute {
		if key, ok := jwksKeys[kid]; ok {
			jwksMu.RUnlock()
			return key, nil
		}
	}
	jwksMu.RUnlock()

	// Fetch JWKS
	if err := fetchJWKS(); err != nil {
		return nil, fmt.Errorf("fetch JWKS: %w", err)
	}

	jwksMu.RLock()
	defer jwksMu.RUnlock()
	if key, ok := jwksKeys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("unknown key ID: %s", kid)
}

func fetchJWKS() error {
	gotrueURL := os.Getenv("GOTRUE_URL")
	if gotrueURL == "" {
		return fmt.Errorf("GOTRUE_URL is not set")
	}

	resp, err := http.Get(gotrueURL + "/.well-known/jwks.json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var jwksResp struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwksResp); err != nil {
		return err
	}

	keys := make(map[string]*ecdsa.PublicKey)
	for _, k := range jwksResp.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" {
			continue
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		keys[k.Kid] = &ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     new(big.Int).SetBytes(xBytes),
			Y:     new(big.Int).SetBytes(yBytes),
		}
	}

	jwksMu.Lock()
	jwksKeys = keys
	jwksFetched = time.Now()
	jwksMu.Unlock()

	return nil
}

// AuthMiddleware extracts and validates the JWT from the Authorization header
// or access_token cookie, then sets the user ID in the request context.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := extractToken(r)
		if tokenStr == "" {
			http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
			return
		}

		claims, err := ValidateJWT(tokenStr)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		userID := claims.Subject
		if userID == "" {
			http.Error(w, `{"error":"invalid token: no subject"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// OptionalAuthMiddleware extracts the JWT if present but doesn't require it.
func OptionalAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := extractToken(r)
		if tokenStr != "" {
			if claims, err := ValidateJWT(tokenStr); err == nil && claims.Subject != "" {
				ctx := context.WithValue(r.Context(), UserIDKey, claims.Subject)
				r = r.WithContext(ctx)
			}
		}
		next.ServeHTTP(w, r)
	})
}

// UserIDFromContext returns the authenticated user ID from the request context.
func UserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(UserIDKey).(string); ok {
		return v
	}
	return ""
}

func extractToken(r *http.Request) string {
	// Check Authorization header first
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	// Check access_token cookie
	if cookie, err := r.Cookie("sb-access-token"); err == nil {
		return cookie.Value
	}

	// Check query parameter (used by EventSource/SSE)
	if token := r.URL.Query().Get("access_token"); token != "" {
		return token
	}

	return ""
}
