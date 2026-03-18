package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"connectrpc.com/connect"
	"github.com/forumline/forumline/forum"
	hubv1 "github.com/forumline/forumline/rpc/forumline/hub/v1"
	"github.com/forumline/forumline/rpc/forumline/hub/v1/hubv1connect"
	"github.com/forumline/forumline/rpc/servicekey"
	"github.com/forumline/forumline/services/hosted/oapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// exportForumResponse is a custom oapi.ExportForumResponseObject that serialises
// *forum.ExportData directly (which uses []json.RawMessage) without an intermediate
// conversion to oapi.ExportData (which uses []map[string]interface{}).
type exportForumResponse struct {
	slug string
	data *forum.ExportData // forum.ExportData from github.com/forumline/forumline/forum
}

func (r exportForumResponse) VisitExportForumResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="`+r.slug+`-export.json"`)
	w.WriteHeader(200)
	return json.NewEncoder(w).Encode(r.data)
}

// ctxKeyForumlineID is the context key for the X-Forumline-ID header value.
type ctxKeyForumlineID struct{}

// ForumlineIDFromContext retrieves the X-Forumline-ID value injected by the auth middleware.
func ForumlineIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyForumlineID{}).(string)
	return v
}

// ForumlineIDMiddleware extracts X-Forumline-ID from the request header and
// injects it into the request context so strict handlers can read it from ctx.
func ForumlineIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Forumline-ID")
		ctx := context.WithValue(r.Context(), ctxKeyForumlineID{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Handlers holds dependencies for all platform API endpoints: forum
// provisioning/listing/export and custom-site file management. It directly
// implements oapi.StrictServerInterface.
type Handlers struct {
	Pool             *pgxpool.Pool
	Store            *TenantStore
	TenantMigrations fs.FS // goose migration files for tenant schemas (nil to skip)
	R2Account        string
	R2KeyID          string
	R2Secret         string
	R2Bucket         string
	SiteCache        *SiteCache
}

// Compile-time check that Handlers satisfies the strict generated interface.
var _ oapi.StrictServerInterface = (*Handlers)(nil)

// ProvisionForum creates a new hosted forum.
// POST /api/platform/forums
func (h *Handlers) ProvisionForum(ctx context.Context, request oapi.ProvisionForumRequestObject) (oapi.ProvisionForumResponseObject, error) {
	forumlineID := ForumlineIDFromContext(ctx)
	if forumlineID == "" {
		return oapi.ProvisionForum401JSONResponse{Error: "authentication required"}, nil
	}

	if request.Body == nil {
		return oapi.ProvisionForum400JSONResponse{Error: "invalid JSON"}, nil
	}

	slug := strings.TrimSpace(strings.ToLower(request.Body.Slug))
	name := strings.TrimSpace(request.Body.Name)

	if slug == "" || name == "" {
		return oapi.ProvisionForum400JSONResponse{Error: "slug and name are required"}, nil
	}

	description := ""
	if request.Body.Description != nil {
		description = *request.Body.Description
	}

	baseDomain := os.Getenv("PLATFORM_BASE_DOMAIN")
	if baseDomain == "" {
		baseDomain = "forumline.net"
	}

	result, err := Provision(ctx, h.Pool, h.Store, &ProvisionRequest{
		Slug:             slug,
		Name:             name,
		Description:      description,
		OwnerForumlineID: forumlineID,
		BaseDomain:       baseDomain,
	}, h.TenantMigrations)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid slug") ||
			strings.Contains(errMsg, "reserved") ||
			strings.Contains(errMsg, "already taken") {
			return oapi.ProvisionForum400JSONResponse{Error: errMsg}, nil
		}
		return oapi.ProvisionForum500JSONResponse{Error: "failed to create forum"}, nil
	}

	// Register with Forumline app so it knows about this forum.
	// We don't have access to the Authorization header in strict mode — the
	// middleware doesn't inject it. Pass empty string; RegisterForumWithForumline
	// handles it gracefully.
	if _, err := RegisterForumWithForumline(ctx, result.Domain, name, ""); err != nil {
		log.Printf("warning: forum provisioned but Forumline registration failed: %v", err)
	}

	return oapi.ProvisionForum201JSONResponse{
		Domain:     result.Domain,
		Slug:       result.Tenant.Slug,
		Name:       result.Tenant.Name,
		SchemaName: result.Tenant.SchemaName,
	}, nil
}

// ListForums returns all active hosted forums.
// GET /api/platform/forums
func (h *Handlers) ListForums(ctx context.Context, _ oapi.ListForumsRequestObject) (oapi.ListForumsResponseObject, error) {
	tenants := h.Store.All()
	forums := make(oapi.ListForums200JSONResponse, 0, len(tenants))
	for _, t := range tenants {
		forums = append(forums, oapi.ForumSummary{
			Slug:        t.Slug,
			Name:        t.Name,
			Domain:      t.Domain,
			Description: t.Description,
			IconUrl:     t.IconURL,
			Theme:       t.Theme,
		})
	}
	return forums, nil
}

// ExportForum exports a forum's data as JSON for migration to self-hosted.
// GET /api/platform/forums/{slug}/export
func (h *Handlers) ExportForum(ctx context.Context, request oapi.ExportForumRequestObject) (oapi.ExportForumResponseObject, error) {
	forumlineID := ForumlineIDFromContext(ctx)
	if forumlineID == "" {
		return oapi.ExportForum401JSONResponse{Error: "authentication required"}, nil
	}

	tenant := h.Store.BySlug(request.Slug)
	if tenant == nil {
		return oapi.ExportForum404JSONResponse{Error: "forum not found"}, nil
	}

	if tenant.OwnerForumlineID != forumlineID {
		return oapi.ExportForum403JSONResponse{Error: "not authorized"}, nil
	}

	data, err := Export(ctx, h.Pool, tenant)
	if err != nil {
		return oapi.ExportForum500JSONResponse{Error: "export failed"}, nil
	}

	return exportForumResponse{slug: request.Slug, data: data}, nil
}

var hubClient hubv1connect.HubServiceClient

func init() {
	forumlineURL := os.Getenv("FORUMLINE_APP_URL")
	if forumlineURL == "" {
		forumlineURL = "https://app.forumline.net"
	}
	hubClient = hubv1connect.NewHubServiceClient(
		http.DefaultClient,
		forumlineURL,
		connect.WithInterceptors(servicekey.NewClientInterceptor(os.Getenv("INTERNAL_SERVICE_KEY"))),
	)
}

// RegisterForumWithForumline calls the HubService to register the forum in the Forumline directory.
func RegisterForumWithForumline(ctx context.Context, domain, name, _ string) (bool, error) {
	resp, err := hubClient.RegisterForum(ctx, connect.NewRequest(&hubv1.RegisterForumRequest{
		Domain:       domain,
		Name:         name,
		Capabilities: []string{"threads", "chat", "voice", "notifications"},
	}))
	if err != nil {
		return false, fmt.Errorf("hub registration failed: %w", err)
	}
	log.Printf("registered forum %s with Forumline hub (created=%v)", domain, resp.Msg.Created)
	return resp.Msg.Created, nil
}
