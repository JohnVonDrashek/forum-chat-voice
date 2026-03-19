package handler

import (
	"context"
	"log"
	"os"

	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"

	hubv1 "github.com/forumline/forumline/rpc/forumline/hub/v1"
	"github.com/forumline/forumline/rpc/forumline/hub/v1/hubv1connect"
	"github.com/forumline/forumline/rpc/servicekey"
	"github.com/forumline/forumline/services/forumline-hub/service"
)

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
		if _, ok := err.(*service.ConflictError); !ok {
			log.Printf("[Hub] best-effort registration failed for %s: %v", msg.Domain, err)
		}
		return connect.NewResponse(&hubv1.RegisterForumResponse{Created: false}), nil
	}
	log.Printf("[Hub] registered forum %s via Connect RPC", msg.Domain)
	return connect.NewResponse(&hubv1.RegisterForumResponse{Created: true}), nil
}

func MountHubService(r chi.Router, forumSvc *service.ForumService) {
	key := os.Getenv("INTERNAL_SERVICE_KEY")
	path, handler := hubv1connect.NewHubServiceHandler(
		&hubConnectServer{forumSvc: forumSvc},
		connect.WithInterceptors(servicekey.NewServerInterceptor(key)),
	)
	r.Handle(path+"{method}", handler)
}
