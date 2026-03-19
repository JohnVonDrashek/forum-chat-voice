package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
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

func (s *Store) ProfileExists(ctx context.Context, id string) (bool, error) {
	return s.Q.ProfileExists(ctx, id)
}

func (s *Store) FetchProfilesByIDs(ctx context.Context, ids []string) (map[string]*Profile, error) {
	profiles := make(map[string]*Profile)
	if len(ids) == 0 {
		return profiles, nil
	}
	rows, err := s.Q.FetchProfilesByIDs(ctx, ids)
	if err != nil {
		return profiles, err
	}
	for _, r := range rows {
		profiles[r.ID] = &Profile{
			ID:          r.ID,
			Username:    r.Username,
			DisplayName: r.DisplayName,
			AvatarURL:   r.AvatarUrl,
		}
	}
	return profiles, nil
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
			AvatarURL:   r.AvatarUrl,
		}
	}
	return results, nil
}

type ProfileSearchResult struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
}

func (s *Store) GetSenderUsername(ctx context.Context, senderID string) string {
	username, err := s.Q.GetSenderUsername(ctx, senderID)
	if err != nil || username == "" {
		return "someone"
	}
	return username
}

func (s *Store) GetOnlineStatusPreferences(ctx context.Context, userIDs []string) (map[string]bool, error) {
	result := make(map[string]bool)
	rows, err := s.Q.GetOnlineStatusPreferences(ctx, userIDs)
	if err != nil {
		return result, err
	}
	for _, r := range rows {
		if !r.ShowOnlineStatus || r.OnlineStatus == "offline" || r.OnlineStatus == "away" {
			result[r.ID] = false
		}
	}
	return result, nil
}

func (s *Store) CountExistingUsers(ctx context.Context, userIDs []string) (int, error) {
	count, err := s.Q.CountExistingUsers(ctx, userIDs)
	return int(count), err
}
