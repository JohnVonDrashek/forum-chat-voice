package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/forumline/forumline/services/forumline-api/sqlcdb"
)

// Profile is minimal internal type for internal services (call, push).
// Clients should query Hasura GraphQL directly for profile CRUD.
type Profile struct {
	ID           string
	Username     string
	DisplayName  string
	AvatarURL    *string
	Bio          *string
	StatusMessage string
	OnlineStatus string
	ShowOnlineStatus bool
}

// GetProfile — minimal version for internal services only (call, push notifications).
// For user-facing profile CRUD, use POST /graphql instead.
func (s *Store) GetProfile(ctx context.Context, id string) (*Profile, error) {
	row, err := s.Q.GetProfile(ctx, id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &Profile{
		ID:               row.ID,
		Username:         row.Username,
		DisplayName:      row.DisplayName,
		AvatarURL:        row.AvatarUrl,
		Bio:              row.Bio,
		StatusMessage:    row.StatusMessage,
		OnlineStatus:     row.OnlineStatus,
		ShowOnlineStatus: row.ShowOnlineStatus,
	}, nil
}

// ProfileExists — used by push notifications to validate recipient exists.
func (s *Store) ProfileExists(ctx context.Context, userID string) (bool, error) {
	return s.Q.ProfileExists(ctx, userID)
}

// UsernameExists — used by auto-provisioning to generate unique username.
func (s *Store) UsernameExists(ctx context.Context, username string) (bool, error) {
	return s.Q.UsernameExists(ctx, username)
}

// CreateProfile — used by auto-provisioning from Zitadel.
func (s *Store) CreateProfile(ctx context.Context, id, username, displayName, avatarURL string) error {
	var avatarPtr *string
	if avatarURL != "" {
		avatarPtr = &avatarURL
	}
	return s.Q.CreateProfile(ctx, sqlcdb.CreateProfileParams{
		ID:          id,
		Username:    username,
		DisplayName: displayName,
		AvatarUrl:   avatarPtr,
	})
}
