package platform

import (
	"context"
	"io/fs"
	"net/http"
	"os"
	"strings"

	"connectrpc.com/connect"
	platformv1 "github.com/forumline/forumline/rpc/forumline/platform/v1"
	"github.com/forumline/forumline/rpc/forumline/platform/v1/platformv1connect"
	"github.com/forumline/forumline/rpc/servicekey"
	"github.com/jackc/pgx/v5/pgxpool"
)

// platformConnectServer implements PlatformServiceHandler for internal service-to-service calls.
// Called by forumline-api when a user creates a *.forumline.net forum.
type platformConnectServer struct {
	Pool             *pgxpool.Pool
	Store            *TenantStore
	TenantMigrations fs.FS
}

var _ platformv1connect.PlatformServiceHandler = (*platformConnectServer)(nil)

func (s *platformConnectServer) ProvisionForum(
	ctx context.Context,
	req *connect.Request[platformv1.ProvisionForumRequest],
) (*connect.Response[platformv1.ProvisionForumResponse], error) {
	msg := req.Msg
	if msg.UserId == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	slug := strings.TrimSpace(strings.ToLower(msg.Slug))
	name := strings.TrimSpace(msg.Name)
	if slug == "" || name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	baseDomain := os.Getenv("PLATFORM_BASE_DOMAIN")
	if baseDomain == "" {
		baseDomain = "forumline.net"
	}

	result, err := Provision(ctx, s.Pool, s.Store, &ProvisionRequest{
		Slug:             slug,
		Name:             name,
		Description:      msg.Description,
		OwnerForumlineID: msg.UserId,
		BaseDomain:       baseDomain,
	}, s.TenantMigrations)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid slug") ||
			strings.Contains(errMsg, "reserved") ||
			strings.Contains(errMsg, "already taken") {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&platformv1.ProvisionForumResponse{
		Domain:     result.Domain,
		Slug:       result.Tenant.Slug,
		Name:       result.Tenant.Name,
		SchemaName: result.Tenant.SchemaName,
	}), nil
}

// NewPlatformConnectServer creates a platformConnectServer with the given dependencies.
func NewPlatformConnectServer(pool *pgxpool.Pool, store *TenantStore, tenantMigrations fs.FS) *platformConnectServer {
	return &platformConnectServer{Pool: pool, Store: store, TenantMigrations: tenantMigrations}
}

// MountPlatformService registers the PlatformService Connect handler on the given mux.
// Requests must carry the correct INTERNAL_SERVICE_KEY header.
func MountPlatformService(mux *http.ServeMux, pool *pgxpool.Pool, store *TenantStore, tenantMigrations fs.FS) {
	srv := NewPlatformConnectServer(pool, store, tenantMigrations)
	key := os.Getenv("INTERNAL_SERVICE_KEY")
	path, handler := platformv1connect.NewPlatformServiceHandler(srv,
		connect.WithInterceptors(servicekey.NewServerInterceptor(key)),
	)
	mux.Handle(path, handler)
}
