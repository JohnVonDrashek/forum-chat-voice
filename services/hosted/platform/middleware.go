package platform

import (
	"context"
	"net/http"
	"strings"
)

type tenantKey struct{}
type tenantSchemaKey struct{}

// TenantFromContext returns the Tenant stored in the request context by
// TenantMiddleware, or nil if not in multi-tenant mode.
func TenantFromContext(ctx context.Context) *Tenant {
	if t, ok := ctx.Value(tenantKey{}).(*Tenant); ok {
		return t
	}
	return nil
}

// SchemaFromContext returns the tenant schema name stored in context, or "".
// This is set for all tenant requests; long-lived handlers (SSE) use it
// for per-query connection acquisition instead of holding a pool connection.
func SchemaFromContext(ctx context.Context) string {
	if s, ok := ctx.Value(tenantSchemaKey{}).(string); ok {
		return s
	}
	return ""
}

// noDBPaths are request paths that don't query the database and can skip
// connection acquisition. This avoids holding a pool connection for
// endpoints that only return in-memory config.
var noDBPaths = map[string]bool{
	"/api/config": true,
	"/health":     true,
}

// isStreamPath returns true for SSE/streaming endpoints that are long-lived
// and should NOT hold a persistent pool connection. These paths get the
// tenant schema stored in context so TenantPool can do per-query
// acquire/release instead.
func isStreamPath(path string) bool {
	return strings.HasSuffix(path, "/stream")
}

// TenantMiddleware resolves the tenant from the Host header, sets the
// database search_path to the tenant's schema, and stores the tenant
// in the request context.
//
// If the host doesn't match any tenant, returns 404.
func TenantMiddleware(store *TenantStore, tp *TenantPool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			// Strip port if present
			if idx := strings.LastIndex(host, ":"); idx != -1 {
				host = host[:idx]
			}

			tenant := store.ByDomain(host)
			if tenant == nil {
				http.Error(w, `{"error":"unknown forum"}`, http.StatusNotFound)
				return
			}

			// Skip DB connection for paths that don't need it
			if noDBPaths[r.URL.Path] {
				ctx := context.WithValue(r.Context(), tenantKey{}, tenant)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// SSE/stream endpoints are long-lived — don't hold a pool
			// connection for their entire lifetime. Instead, store the
			// schema name so TenantPool can acquire/release per-query.
			if isStreamPath(r.URL.Path) {
				ctx := context.WithValue(r.Context(), tenantKey{}, tenant)
				ctx = context.WithValue(ctx, tenantSchemaKey{}, tenant.SchemaName)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Acquire a connection and set search_path for this tenant
			ctx, release, err := tp.SetTenant(r.Context(), tenant.SchemaName)
			if err != nil {
				http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
				return
			}
			defer release()

			// Store tenant in context for handlers that need it
			ctx = context.WithValue(ctx, tenantKey{}, tenant)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
