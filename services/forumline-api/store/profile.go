package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/jackc/pgx/v5"
)

func (s *Store) GetProfile(ctx context.Context, id string) (*model.Profile, error) {
	var p model.Profile
	err := s.Pool.QueryRow(ctx,
		`SELECT id, username, display_name, avatar_url, bio, status_message, online_status, show_online_status
		 FROM forumline_profiles WHERE id = $1`, id,
	).Scan(&p.ID, &p.Username, &p.DisplayName, &p.AvatarURL, &p.Bio,
		&p.StatusMessage, &p.OnlineStatus, &p.ShowOnlineStatus)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) CreateProfile(ctx context.Context, id, username, displayName, avatarURL string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_profiles (id, username, display_name, avatar_url) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO NOTHING`,
		id, username, displayName, avatarURL,
	)
	return err
}

func (s *Store) UsernameExists(ctx context.Context, username string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE username = $1)`, username,
	).Scan(&exists)
	return exists, err
}

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
	_, err := s.Pool.Exec(ctx, `DELETE FROM auth.users WHERE id = $1`, id)
	return err
}

func (s *Store) SearchProfiles(ctx context.Context, query, excludeUserID string) ([]model.ProfileSearchResult, error) {
	pattern := "%" + query + "%"
	rows, err := s.Pool.Query(ctx,
		`SELECT id, username, display_name, avatar_url
		 FROM forumline_profiles
		 WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2)
		 LIMIT 10`,
		excludeUserID, pattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []model.ProfileSearchResult
	for rows.Next() {
		var p model.ProfileSearchResult
		if err := rows.Scan(&p.ID, &p.Username, &p.DisplayName, &p.AvatarURL); err != nil {
			continue
		}
		results = append(results, p)
	}
	if results == nil {
		results = []model.ProfileSearchResult{}
	}
	return results, nil
}

func (s *Store) ProfileExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1)`, id,
	).Scan(&exists)
	return exists, err
}

func (s *Store) FetchProfilesByIDs(ctx context.Context, ids []string) (map[string]*model.Profile, error) {
	profiles := make(map[string]*model.Profile)
	if len(ids) == 0 {
		return profiles, nil
	}

	rows, err := s.Pool.Query(ctx,
		`SELECT id, username, display_name, avatar_url FROM forumline_profiles WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return profiles, err
	}
	defer rows.Close()

	for rows.Next() {
		p := &model.Profile{}
		if err := rows.Scan(&p.ID, &p.Username, &p.DisplayName, &p.AvatarURL); err != nil {
			continue
		}
		profiles[p.ID] = p
	}
	return profiles, nil
}
