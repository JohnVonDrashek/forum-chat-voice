package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/zitadel/zitadel-go/v3/pkg/client"
	userv2 "github.com/zitadel/zitadel-go/v3/pkg/client/zitadel/user/v2"
	"github.com/zitadel/zitadel-go/v3/pkg/zitadel"
)

// ZitadelClient wraps the Zitadel Management API client.
// Used for user management (deletion). OIDC app creation for forums
// is no longer needed — auth is handled by id.forumline.net.
type ZitadelClient struct {
	api *client.Client
}

var (
	zitadelOnce   sync.Once
	zitadelClient *ZitadelClient
	zitadelErr    error
)

// GetZitadelClient returns the singleton Zitadel API client.
// Initializes on first call using ZITADEL_URL and ZITADEL_SERVICE_USER_PAT env vars.
func GetZitadelClient(ctx context.Context) (*ZitadelClient, error) {
	zitadelOnce.Do(func() {
		zitadelClient, zitadelErr = initZitadelClient(ctx)
	})
	return zitadelClient, zitadelErr
}

func initZitadelClient(ctx context.Context) (*ZitadelClient, error) {
	zitadelURL := os.Getenv("ZITADEL_URL")
	pat := os.Getenv("ZITADEL_SERVICE_USER_PAT")
	if zitadelURL == "" || pat == "" {
		return nil, fmt.Errorf("ZITADEL_URL and ZITADEL_SERVICE_USER_PAT are required")
	}

	api, err := client.New(ctx,
		zitadel.New(zitadelURL),
		client.WithAuth(client.PAT(pat)),
	)
	if err != nil {
		return nil, fmt.Errorf("init zitadel client: %w", err)
	}

	log.Println("[Zitadel] Client initialized")
	return &ZitadelClient{api: api}, nil
}

// DeleteUser deletes a user from Zitadel.
func (z *ZitadelClient) DeleteUser(ctx context.Context, userID string) error {
	_, err := z.api.UserServiceV2().DeleteUser(ctx, &userv2.DeleteUserRequest{
		UserId: userID,
	})
	return err
}

// Close closes the Zitadel gRPC connection.
func (z *ZitadelClient) Close() {
	if z.api != nil {
		_ = z.api.Close()
	}
}
