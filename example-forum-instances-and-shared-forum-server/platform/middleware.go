package platform

import (
	"context"
	"net/http"
	"strings"
)

type tenantKey struct{}

// TenantFromContext returns the Tenant stored in the request context by
// TenantMiddleware, or nil if not in multi-tenant mode.
func TenantFromContext(ctx context.Context) *Tenant {
	if t, ok := ctx.Value(tenantKey{}).(*Tenant); ok {
		return t
	}
	return nil
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
