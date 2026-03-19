package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/zitadel/zitadel-go/v3/pkg/client"
	userv2 "github.com/zitadel/zitadel-go/v3/pkg/client/zitadel/user/v2"
	"github.com/zitadel/zitadel-go/v3/pkg/zitadel"
)

type ZitadelClient struct {
	api *client.Client
}

type ZitadelUserInfo struct {
	ID          string
	Username    string
	DisplayName string
	AvatarURL   string
}

var (
	zitadelOnce   sync.Once
	zitadelClient *ZitadelClient
	zitadelErr    error
)

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

	zitadelDomain := strings.TrimPrefix(strings.TrimPrefix(zitadelURL, "https://"), "http://")

	api, err := client.New(ctx,
		zitadel.New(zitadelDomain),
		client.WithAuth(client.PAT(pat)),
	)
	if err != nil {
		return nil, fmt.Errorf("init zitadel client: %w", err)
	}

	log.Println("[Zitadel] Client initialized")
	return &ZitadelClient{api: api}, nil
}

func (z *ZitadelClient) DeleteUser(ctx context.Context, userID string) error {
	_, err := z.api.UserServiceV2().DeleteUser(ctx, &userv2.DeleteUserRequest{
		UserId: userID,
	})
	return err
}

func (z *ZitadelClient) Close() {
	if z.api != nil {
		_ = z.api.Close()
	}
}
