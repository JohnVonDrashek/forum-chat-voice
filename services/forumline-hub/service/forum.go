package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/forumline/forumline/services/forumline-hub/store"
)

type ForumService struct {
	Store *store.Store
}

func NewForumService(s *store.Store) *ForumService {
	return &ForumService{Store: s}
}

type RegisterForumInput struct {
	Domain       string
	Name         string
	APIBase      string
	WebBase      string
	Capabilities []string
	Description  *string
	Tags         []string
}

type RegisterForumResult struct {
	ForumID  uuid.UUID
	Approved bool
	Message  string
}

func (fs *ForumService) RegisterForum(ctx context.Context, userID string, input RegisterForumInput) (*RegisterForumResult, error) {
	if input.Domain == "" || input.Name == "" || input.APIBase == "" || input.WebBase == "" {
		return nil, &ValidationError{Msg: "domain, name, api_base, and web_base are required"}
	}
	if err := ValidateDomain(input.Domain); err != nil {
		return nil, &ValidationError{Msg: fmt.Sprintf("invalid domain: %v", err)}
	}
	for _, u := range []string{input.APIBase, input.WebBase} {
		if _, err := url.ParseRequestURI(u); err != nil {
			return nil, &ValidationError{Msg: fmt.Sprintf("invalid URL: %s", u)}
		}
	}

	count, err := fs.Store.CountForumsByOwner(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to check forum quota: %w", err)
	}
	if count >= 5 {
		return nil, &ForbiddenError{Msg: "Maximum of 5 forums per user"}
	}

	exists, _ := fs.Store.DomainExists(ctx, input.Domain)
	if exists {
		return nil, &ConflictError{Msg: "Forum with this domain is already registered"}
	}

	tags := NormalizeTags(input.Tags)
	forumID, err := fs.Store.RegisterForum(ctx, input.Domain, input.Name, input.APIBase, input.WebBase,
		input.Capabilities, input.Description, tags, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to register forum: %w", err)
	}

	return &RegisterForumResult{
		ForumID:  forumID,
		Approved: false,
		Message:  "Forum registered.",
	}, nil
}

func (fs *ForumService) ResolveOrDiscoverForum(ctx context.Context, domain string) (uuid.UUID, error) {
	forumID := fs.Store.GetForumIDByDomain(ctx, domain)
	if forumID != (uuid.UUID{}) {
		return forumID, nil
	}

	manifest, err := FetchForumManifest(domain)
	if err != nil {
		return uuid.UUID{}, err
	}

	manifest.Domain = domain
	tags := NormalizeTags(manifest.Tags)

	forumID, err = fs.Store.UpsertForumFromManifest(ctx, manifest, tags)
	if err != nil {
		return uuid.UUID{}, err
	}
	if forumID == (uuid.UUID{}) {
		forumID = fs.Store.GetForumIDByDomain(ctx, domain)
	}
	if forumID == (uuid.UUID{}) {
		return uuid.UUID{}, fmt.Errorf("failed to resolve forum")
	}
	return forumID, nil
}

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

func FetchForumManifest(domain string) (*store.ForumManifest, error) {
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

	limitedBody := io.LimitReader(resp.Body, 1<<20)
	var manifest store.ForumManifest
	if err := json.NewDecoder(limitedBody).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("failed to decode manifest: %w", err)
	}

	if manifest.Name == "" || manifest.APIBase == "" || manifest.WebBase == "" {
		return nil, fmt.Errorf("manifest missing required fields")
	}

	manifest.Domain = domain
	return &manifest, nil
}

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
