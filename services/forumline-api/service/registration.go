package service

import (
	"context"
	"fmt"
	"net/url"
)

// RegisterForumInput contains validated input for forum registration.
type RegisterForumInput struct {
	Domain       string
	Name         string
	APIBase      string
	WebBase      string
	Capabilities []string
	Description  *string
	Tags         []string
}

// RegisterForumResult contains the outcome of a forum registration.
type RegisterForumResult struct {
	ForumID  string
	Approved bool
	Message  string
}

// RegisterForum handles the full forum registration flow: validation, quota check,
// domain conflict resolution, and new forum creation.
// Auth for hosted forums is handled by id.forumline.net — no per-forum OIDC clients needed.
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
