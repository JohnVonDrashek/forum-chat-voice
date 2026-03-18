package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"connectrpc.com/connect"
	hubv1 "github.com/forumline/forumline/rpc/forumline/hub/v1"
	"github.com/forumline/forumline/rpc/forumline/hub/v1/hubv1connect"
	"github.com/forumline/forumline/rpc/servicekey"
	"github.com/forumline/forumline/services/forumline-api/service"
)

// hubConnectServer implements HubServiceHandler for internal service-to-service calls.
// Called by the hosted service when a forum tenant is provisioned.
type hubConnectServer struct {
	forumSvc *service.ForumService
}

var _ hubv1connect.HubServiceHandler = (*hubConnectServer)(nil)

func (h *hubConnectServer) RegisterForum(
	ctx context.Context,
	req *connect.Request[hubv1.RegisterForumRequest],
) (*connect.Response[hubv1.RegisterForumResponse], error) {
	msg := req.Msg
	siteURL := "https://" + msg.Domain
	_, err := h.forumSvc.RegisterForum(ctx, "", service.RegisterForumInput{
		Domain:       msg.Domain,
		Name:         msg.Name,
		APIBase:      siteURL + "/api/forumline",
		WebBase:      siteURL,
		Capabilities: msg.Capabilities,
	})
	if err != nil {
		// Hub registration is best-effort — hosted may not have a real owner to attach.
		// ConflictError = already registered (normal for the primary flow).
		// Any other error = log and continue; caller ignores Created: false.
		if _, ok := err.(*service.ConflictError); !ok {
			log.Printf("[Hub] best-effort registration failed for %s: %v", msg.Domain, err)
		}
		return connect.NewResponse(&hubv1.RegisterForumResponse{Created: false}), nil
	}
	log.Printf("[Hub] registered forum %s via Connect RPC", msg.Domain)
	return connect.NewResponse(&hubv1.RegisterForumResponse{Created: true}), nil
}

// mountHubService registers the HubService Connect handler on the given mux.
// Requests must carry the correct INTERNAL_SERVICE_KEY header.
func mountHubService(mux *http.ServeMux, forumSvc *service.ForumService) {
	key := os.Getenv("INTERNAL_SERVICE_KEY")
	path, handler := hubv1connect.NewHubServiceHandler(
		&hubConnectServer{forumSvc: forumSvc},
		connect.WithInterceptors(servicekey.NewServerInterceptor(key)),
	)
	mux.Handle(path, handler)
}
