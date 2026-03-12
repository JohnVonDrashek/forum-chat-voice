package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type ForumService struct {
	Store *store.Store
}

func NewForumService(s *store.Store) *ForumService {
	return &ForumService{Store: s}
}

// ResolveOrDiscoverForum looks up a forum by domain; if not found, fetches the
// manifest from /.well-known/forumline-manifest.json and auto-registers it.
// Returns the forum ID.
func (fs *ForumService) ResolveOrDiscoverForum(ctx context.Context, domain string) (string, error) {
	forumID := fs.Store.GetForumIDByDomain(ctx, domain)
	if forumID != "" {
		return forumID, nil
	}

	manifest, err := FetchForumManifest(domain)
	if err != nil {
		return "", err
	}

	// Always use the requested domain — never trust the manifest's domain claim
	manifest.Domain = domain
	tags := NormalizeTags(manifest.Tags)

	forumID, err = fs.Store.UpsertForumFromManifest(ctx, manifest, tags)
	if err != nil {
		return "", err
	}
	if forumID == "" {
		// Forum existed and was approved — fetch the existing ID
		forumID = fs.Store.GetForumIDByDomain(ctx, domain)
	}
	if forumID == "" {
		return "", fmt.Errorf("failed to resolve forum")
	}
	return forumID, nil
}

// ValidateDomain checks that a domain is a plausible public hostname,
// rejecting path separators, query strings, and private/loopback IPs.
func ValidateDomain(domain string) error {
	if domain == "" {
		return fmt.Errorf("domain is empty")
	}
	if strings.ContainsAny(domain, "/#?@ \t\n\r") {
		return fmt.Errorf("domain contains invalid characters")
	}
	host := domain
	if h, _, err := net.SplitHostPort(domain); err == nil {
		host = h
	}
	if ip := net.ParseIP(host); ip != nil {
		return fmt.Errorf("domain must be a hostname, not an IP address")
	}
	if !strings.Contains(host, ".") {
		return fmt.Errorf("domain must be a fully qualified hostname")
	}
	return nil
}

// FetchForumManifest fetches a forum's manifest from /.well-known/forumline-manifest.json.
func FetchForumManifest(domain string) (*model.ForumManifest, error) {
	if err := ValidateDomain(domain); err != nil {
		return nil, fmt.Errorf("invalid domain: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet,
		fmt.Sprintf("https://%s/.well-known/forumline-manifest.json", domain), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create manifest request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest returned status %d", resp.StatusCode)
	}

	limitedBody := io.LimitReader(resp.Body, 1<<20) // 1 MB max
	var manifest model.ForumManifest
	if err := json.NewDecoder(limitedBody).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("failed to decode manifest: %w", err)
	}

	if manifest.Name == "" || manifest.APIBase == "" || manifest.WebBase == "" {
		return nil, fmt.Errorf("manifest missing required fields")
	}

	manifest.Domain = domain
	return &manifest, nil
}

// NormalizeTags lowercases, trims, deduplicates, and caps tags.
// Max 10 tags, max 32 chars each.
func NormalizeTags(raw []string) []string {
	if len(raw) == 0 {
		return []string{}
	}
	seen := make(map[string]bool)
	var result []string
	for _, t := range raw {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		if utf8.RuneCountInString(t) > 32 {
			runes := []rune(t)
			t = string(runes[:32])
		}
		seen[t] = true
		result = append(result, t)
		if len(result) >= 10 {
			break
		}
	}
	if result == nil {
		return []string{}
	}
	return result
}
