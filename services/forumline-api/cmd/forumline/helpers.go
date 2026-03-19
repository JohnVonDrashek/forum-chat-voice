package main

// helpers.go contains business logic extracted from handler/ for use by StrictServer.
// When the handler/ package is eventually removed, these can move to service/.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"connectrpc.com/connect"
	lkauth "github.com/livekit/protocol/auth"
	platformv1 "github.com/forumline/forumline/rpc/forumline/platform/v1"
	"github.com/forumline/forumline/rpc/forumline/platform/v1/platformv1connect"
	"github.com/forumline/forumline/rpc/servicekey"

	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/store"
)

// --- Activity feed ---

type activityThread struct {
	ID         string           `json:"id"`
	Title      string           `json:"title"`
	PostCount  int              `json:"post_count"`
	LastPostAt *string          `json:"last_post_at"`
	CreatedAt  string           `json:"created_at"`
	Author     activityAuthor   `json:"author"`
	Category   activityCategory `json:"category"`
}

type activityAuthor struct {
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

type activityCategory struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type activityItem struct {
	ThreadID    string  `json:"thread_id"`
	ThreadTitle string  `json:"thread_title"`
	Author      string  `json:"author"`
	AvatarURL   *string `json:"avatar_url"`
	Action      string  `json:"action"`
	ForumName   string  `json:"forum_name"`
	ForumDomain string  `json:"forum_domain"`
	Category    string  `json:"category"`
	Timestamp   string  `json:"timestamp"`
}

// fetchActivityItems fetches recent thread activity from each joined forum concurrently.
func fetchActivityItems(ctx context.Context, memberships []oapi.Membership) ([]activityItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var mu sync.Mutex
	var items []activityItem
	var wg sync.WaitGroup

	for _, m := range memberships {
		wg.Add(1)
		go func(webBase, forumName, forumDomain string) {
			defer wg.Done()
			threads, err := fetchForumThreads(ctx, webBase)
			if err != nil {
				log.Printf("[activity] failed to fetch threads from %s: %v", forumDomain, err)
				return
			}
			mu.Lock()
			for _, t := range threads {
				action := "posted"
				ts := t.CreatedAt
				if t.PostCount > 0 && t.LastPostAt != nil {
					action = "active"
					ts = *t.LastPostAt
				}
				author := t.Author.Username
				if t.Author.DisplayName != nil && *t.Author.DisplayName != "" {
					author = *t.Author.DisplayName
				}
				items = append(items, activityItem{
					ThreadID:    t.ID,
					ThreadTitle: t.Title,
					Author:      author,
					AvatarURL:   t.Author.AvatarURL,
					Action:      action,
					ForumName:   forumName,
					ForumDomain: forumDomain,
					Category:    t.Category.Name,
					Timestamp:   ts,
				})
			}
			mu.Unlock()
		}(m.WebBase, m.ForumName, m.ForumDomain)
	}

	wg.Wait()

	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})
	if len(items) > 20 {
		items = items[:20]
	}
	if items == nil {
		items = []activityItem{}
	}
	return items, nil
}

func fetchForumThreads(ctx context.Context, webBase string) ([]activityThread, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", webBase+"/api/threads?limit=10", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}
	var threads []activityThread
	if err := json.NewDecoder(resp.Body).Decode(&threads); err != nil {
		return nil, err
	}
	return threads, nil
}

// --- LiveKit token ---

func generateLiveKitToken(apiKey, apiSecret, callID, userID string, s *store.Store, ctx context.Context) (string, error) {
	profile, _ := s.GetProfile(ctx, userID)
	participantName := userID
	if profile != nil {
		if profile.DisplayName != "" {
			participantName = profile.DisplayName
		} else {
			participantName = profile.Username
		}
	}

	boolTrue := true
	at := lkauth.NewAccessToken(apiKey, apiSecret)
	grant := &lkauth.VideoGrant{
		Room:         "call-" + callID,
		RoomJoin:     true,
		CanPublish:   &boolTrue,
		CanSubscribe: &boolTrue,
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID).
		SetName(participantName).
		SetValidFor(time.Hour)

	return at.ToJWT()
}

// --- Forum provisioning ---

// hostedPlatformURL is the base URL for the hosted platform (PlatformService Connect endpoint).
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

// provisionHostedForum calls the hosted PlatformService to create the actual forum tenant.
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

// --- Generic helpers ---

// derefStrSlice dereferences a *[]string, returning nil if the pointer is nil.
func derefStrSlice(p *[]string) []string {
	if p == nil {
		return nil
	}
	return *p
}

