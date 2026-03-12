package store

import (
	"context"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListMemberships(ctx context.Context, userID string) ([]model.Membership, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT m.id, m.joined_at, m.forum_authed_at, m.notifications_muted,
		        f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities
		 FROM forumline_memberships m
		 JOIN forumline_forums f ON f.id = m.forum_id
		 WHERE m.user_id = $1
		 ORDER BY m.joined_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memberships []model.Membership
	for rows.Next() {
		var m model.Membership
		var id string
		var joinedAt time.Time
		var forumAuthedAt *time.Time
		var notifMuted bool

		if err := rows.Scan(&id, &joinedAt, &forumAuthedAt, &notifMuted,
			&m.ForumDomain, &m.ForumName, &m.ForumIconURL, &m.APIBase, &m.WebBase, &m.Capabilities); err != nil {
			continue
		}
		m.JoinedAt = joinedAt.Format(time.RFC3339)
		if forumAuthedAt != nil {
			s := forumAuthedAt.Format(time.RFC3339)
			m.ForumAuthedAt = &s
		}
		m.NotificationsMuted = notifMuted
		memberships = append(memberships, m)
	}
	if memberships == nil {
		memberships = []model.Membership{}
	}
	return memberships, nil
}

func (s *Store) UpsertMembership(ctx context.Context, userID, forumID string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_memberships (user_id, forum_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, forumID,
	)
	return err
}

func (s *Store) DeleteMembership(ctx context.Context, userID, forumID string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM forumline_memberships WHERE user_id = $1 AND forum_id = $2`, userID, forumID,
	)
	return err
}

func (s *Store) UpdateMembershipAuth(ctx context.Context, userID, forumID string, authed bool) error {
	if authed {
		_, err := s.Pool.Exec(ctx,
			`UPDATE forumline_memberships SET forum_authed_at = now() WHERE user_id = $1 AND forum_id = $2`,
			userID, forumID)
		return err
	}
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_memberships SET forum_authed_at = NULL WHERE user_id = $1 AND forum_id = $2`,
		userID, forumID)
	return err
}

func (s *Store) UpdateMembershipMute(ctx context.Context, userID, forumID string, muted bool) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_memberships SET notifications_muted = $1 WHERE user_id = $2 AND forum_id = $3`,
		muted, userID, forumID)
	return err
}

func (s *Store) GetMembershipJoinDetails(ctx context.Context, forumID, userID string) (map[string]interface{}, error) {
	var domain, name, apiBase, webBase string
	var iconURL *string
	var capabilities []string
	var joinedAt time.Time

	err := s.Pool.QueryRow(ctx,
		`SELECT f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities, m.joined_at
		 FROM forumline_forums f
		 JOIN forumline_memberships m ON m.forum_id = f.id
		 WHERE f.id = $1 AND m.user_id = $2`, forumID, userID,
	).Scan(&domain, &name, &iconURL, &apiBase, &webBase, &capabilities, &joinedAt)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"domain": domain, "name": name, "icon_url": iconURL,
		"api_base": apiBase, "web_base": webBase, "capabilities": capabilities,
		"joined_at": joinedAt.Format(time.RFC3339),
	}, nil
}

func (s *Store) IsNotificationsMuted(ctx context.Context, userID, forumID string) (bool, error) {
	var muted bool
	err := s.Pool.QueryRow(ctx,
		`SELECT notifications_muted FROM forumline_memberships WHERE user_id = $1 AND forum_id = $2`,
		userID, forumID,
	).Scan(&muted)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return muted, nil
}
