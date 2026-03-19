package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/forumline/forumline/services/forumline-hub/sqlcdb"
	"github.com/jackc/pgx/v5"
)

type Profile struct {
	ID               string
	Username         string
	DisplayName      string
	AvatarURL        *string
	Bio              *string
	StatusMessage    string
	OnlineStatus     string
	ShowOnlineStatus bool
}

type ProfileSearchResult struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name,omitempty"`
	AvatarUrl   *string `json:"avatar_url,omitempty"`
}

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

func (s *Store) UsernameExists(ctx context.Context, username string) (bool, error) {
	return s.Q.UsernameExists(ctx, username)
}

// UpdateProfile uses dynamic SQL — can't be expressed in sqlc.
func (s *Store) UpdateProfile(ctx context.Context, id string, sets map[string]interface{}) error {
	if len(sets) == 0 {
		return nil
	}
	clauses := make([]string, 0, len(sets))
	args := make([]interface{}, 0, len(sets)+1)
	i := 1
	for col, val := range sets {
		clauses = append(clauses, fmt.Sprintf("%s = $%d", col, i))
		args = append(args, val)
		i++
	}
	args = append(args, id)
	query := fmt.Sprintf("UPDATE forumline_profiles SET %s WHERE id = $%d", strings.Join(clauses, ", "), i)
	_, err := s.Pool.Exec(ctx, query, args...)
	return err
}

func (s *Store) DeleteUser(ctx context.Context, id string) error {
	return s.Q.DeleteUser(ctx, id)
}

func (s *Store) SearchProfiles(ctx context.Context, query, excludeUserID string) ([]ProfileSearchResult, error) {
	pattern := "%" + query + "%"
	rows, err := s.Q.SearchProfiles(ctx, sqlcdb.SearchProfilesParams{
		ID:       excludeUserID,
		Username: pattern,
	})
	if err != nil {
		return nil, err
	}
	results := make([]ProfileSearchResult, len(rows))
	for i, r := range rows {
		var displayNamePtr *string
		if r.DisplayName != "" {
			displayNamePtr = &r.DisplayName
		}
		results[i] = ProfileSearchResult{
			ID:          r.ID,
			Username:    r.Username,
			DisplayName: displayNamePtr,
			AvatarUrl:   r.AvatarUrl,
		}
	}
	return results, nil
}
