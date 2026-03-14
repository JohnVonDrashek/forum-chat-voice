package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"

	"github.com/forumline/forumline/services/forumline-api/store"
	"golang.org/x/crypto/bcrypt"
)

// OAuthCredentials holds generated OAuth client credentials.
type OAuthCredentials struct {
	ClientID     string
	ClientSecret string
}

// GenerateOAuthCredentials creates a new OAuth client_id and client_secret pair,
// hashes the secret, and stores the client in the database.
func GenerateOAuthCredentials(ctx context.Context, s *store.Store, forumID string, redirectURIs []string) (*OAuthCredentials, error) {
	cidBytes := make([]byte, 16)
	csBytes := make([]byte, 32)
	if _, err := rand.Read(cidBytes); err != nil {
		return nil, fmt.Errorf("failed to generate client_id: %w", err)
	}
	if _, err := rand.Read(csBytes); err != nil {
		return nil, fmt.Errorf("failed to generate client_secret: %w", err)
	}
	clientID := hex.EncodeToString(cidBytes)
	clientSecret := hex.EncodeToString(csBytes)
	hash, err := bcrypt.GenerateFromPassword([]byte(clientSecret), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash client_secret: %w", err)
	}

	if err := s.CreateOAuthClient(ctx, forumID, clientID, string(hash), redirectURIs); err != nil {
		return nil, fmt.Errorf("failed to create OAuth client: %w", err)
	}

	return &OAuthCredentials{ClientID: clientID, ClientSecret: clientSecret}, nil
}

// defaultRedirectURIs returns the default redirect URI for a forum's web base.
func defaultRedirectURIs(webBase string) []string {
	return []string{webBase + "/api/forumline/auth/callback"}
}

// RegisterForumInput contains validated input for forum registration.
type RegisterForumInput struct {
	Domain       string
	Name         string
	APIBase      string
	WebBase      string
	Capabilities []string
	Description  *string
	Tags         []string
	RedirectURIs []string
}

// RegisterForumResult contains the outcome of a forum registration.
type RegisterForumResult struct {
	ForumID      string
	ClientID     string
	ClientSecret string
	Approved     bool
	Message      string
}

// RegisterForum handles the full forum registration flow: validation, quota check,
// domain conflict resolution (with OAuth provisioning), and new forum creation.
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
		return fs.handleExistingDomain(ctx, input)
	}

	tags := NormalizeTags(input.Tags)
	forumID, err := fs.Store.RegisterForum(ctx, input.Domain, input.Name, input.APIBase, input.WebBase,
		input.Capabilities, input.Description, tags, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to register forum: %w", err)
	}

	redirectURIs := input.RedirectURIs
	if len(redirectURIs) == 0 {
		redirectURIs = defaultRedirectURIs(input.WebBase)
	}
	creds, err := GenerateOAuthCredentials(ctx, fs.Store, forumID, redirectURIs)
	if err != nil {
		_ = fs.Store.DeleteForumByID(ctx, forumID)
		return nil, err
	}

	return &RegisterForumResult{
		ForumID:      forumID,
		ClientID:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		Approved:     false,
		Message:      "Forum registered. OAuth credentials generated. Forum requires approval before appearing in public listings.",
	}, nil
}

// handleExistingDomain handles the case where a domain is already registered.
// If the forum has no OAuth credentials, it provisions them.
func (fs *ForumService) handleExistingDomain(ctx context.Context, input RegisterForumInput) (*RegisterForumResult, error) {
	forumID := fs.Store.GetForumIDByDomain(ctx, input.Domain)
	if forumID == "" {
		return nil, &ConflictError{Msg: "Forum with this domain is already registered"}
	}

	hasOAuth, _ := fs.Store.OAuthClientExistsByForumID(ctx, forumID)
	if hasOAuth {
		return nil, &ConflictError{Msg: "Forum with this domain is already registered"}
	}

	redirectURIs := input.RedirectURIs
	if len(redirectURIs) == 0 {
		redirectURIs = defaultRedirectURIs(input.WebBase)
	}
	creds, err := GenerateOAuthCredentials(ctx, fs.Store, forumID, redirectURIs)
	if err != nil {
		return nil, err
	}

	return &RegisterForumResult{
		ForumID:      forumID,
		ClientID:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		Approved:     true,
		Message:      "OAuth credentials created for existing forum.",
	}, nil
}

// EnsureOAuth creates (or re-creates) OAuth credentials for an existing forum.
// Used by admin/service-key endpoints.
func (fs *ForumService) EnsureOAuth(ctx context.Context, domain string) (*OAuthCredentials, error) {
	if domain == "" {
		return nil, &ValidationError{Msg: "domain is required"}
	}
	forumID := fs.Store.GetForumIDByDomain(ctx, domain)
	if forumID == "" {
		return nil, &NotFoundError{Msg: "forum not found"}
	}

	// Delete existing OAuth client if present (allows re-provisioning)
	_ = fs.Store.DeleteOAuthClientByForumID(ctx, forumID)

	redirectURIs := []string{"https://" + domain + "/api/forumline/auth/callback"}
	return GenerateOAuthCredentials(ctx, fs.Store, forumID, redirectURIs)
}
