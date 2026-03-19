package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"connectrpc.com/connect"

	"github.com/forumline/forumline/backend/httpkit"
	platformv1 "github.com/forumline/forumline/rpc/forumline/platform/v1"
	"github.com/forumline/forumline/rpc/forumline/platform/v1/platformv1connect"
	"github.com/forumline/forumline/rpc/servicekey"
	"github.com/forumline/forumline/services/forumline-hub/service"
)

func writeServiceError(w http.ResponseWriter, err error) {
	var valErr *service.ValidationError
	var notFoundErr *service.NotFoundError
	var conflictErr *service.ConflictError
	var forbiddenErr *service.ForbiddenError
	switch {
	case errors.As(err, &valErr):
		httpkit.WriteError(w, http.StatusBadRequest, valErr.Msg)
	case errors.As(err, &notFoundErr):
		httpkit.WriteError(w, http.StatusNotFound, notFoundErr.Msg)
	case errors.As(err, &conflictErr):
		httpkit.WriteError(w, http.StatusConflict, conflictErr.Msg)
	case errors.As(err, &forbiddenErr):
		httpkit.WriteError(w, http.StatusForbidden, forbiddenErr.Msg)
	default:
		log.Printf("[api] unhandled error: %v", err)
		httpkit.WriteError(w, http.StatusInternalServerError, "internal server error")
	}
}

var hostedPlatformURL string //nolint:gosec // Not a credential — this is a URL constant.

var platformClient platformv1connect.PlatformServiceClient

func init() {
	hostedPlatformURL = os.Getenv("HOSTED_PLATFORM_URL")
	if hostedPlatformURL == "" {
		hostedPlatformURL = "https://hosted.forumline.net"
	}
	platformClient = platformv1connect.NewPlatformServiceClient(
		http.DefaultClient,
		hostedPlatformURL,
		connect.WithInterceptors(servicekey.NewClientInterceptor(os.Getenv("INTERNAL_SERVICE_KEY"))),
	)
}

func provisionHostedForum(ctx context.Context, _, userID, slug, name, description string) error {
	_, err := platformClient.ProvisionForum(ctx, connect.NewRequest(&platformv1.ProvisionForumRequest{
		UserId:      userID,
		Slug:        slug,
		Name:        name,
		Description: description,
	}))
	if err != nil {
		return fmt.Errorf("provision request failed: %w", err)
	}
	log.Printf("[Forums] provisioned hosted forum: slug=%s", slug)
	return nil
}

// provisionHostedForumHTTP is kept as a fallback if the Connect client isn't available.
// Currently unused — provisionHostedForum uses the Connect RPC client.
func provisionHostedForumHTTP(ctx context.Context, authHeader, userID, slug, name, description string) error {
	body := map[string]string{"slug": slug, "name": name, "description": description}
	bodyJSON, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, "POST", hostedPlatformURL+"/api/platform/forums", bytes.NewReader(bodyJSON))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forumline-ID", userID)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := http.DefaultClient.Do(req) //nolint:gosec // URL is from trusted env var.
	if err != nil {
		return fmt.Errorf("provision request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("hosted platform returned %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("[Forums] provisioned hosted forum (HTTP): slug=%s", slug)
	return nil
}
