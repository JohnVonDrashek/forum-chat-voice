package store

import (
	"context"

	"github.com/forumline/forumline/services/forumline-api/model"
)

func (s *Store) UpsertPushSubscription(ctx context.Context, userID, endpoint, p256dh, auth string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
		userID, endpoint, p256dh, auth,
	)
	return err
}

func (s *Store) DeletePushSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint,
	)
	return err
}

func (s *Store) ListPushSubscriptions(ctx context.Context, userID string) ([]model.PushSubscription, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []model.PushSubscription
	for rows.Next() {
		var sub model.PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			continue
		}
		subs = append(subs, sub)
	}
	return subs, nil
}

func (s *Store) DeleteStaleEndpoints(ctx context.Context, userID string, endpoints []string) {
	if len(endpoints) == 0 {
		return
	}
	_, _ = s.Pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = ANY($2)`,
		userID, endpoints,
	)
}

func (s *Store) GetSenderUsername(ctx context.Context, senderID string) string {
	var username string
	_ = s.Pool.QueryRow(ctx,
		`SELECT username FROM forumline_profiles WHERE id = $1`, senderID,
	).Scan(&username)
	if username == "" {
		return "someone"
	}
	return username
}

func (s *Store) GetOnlineStatusPreferences(ctx context.Context, userIDs []string) (map[string]bool, error) {
	result := make(map[string]bool)
	rows, err := s.Pool.Query(ctx,
		`SELECT id::text, online_status, show_online_status
		 FROM forumline_profiles WHERE id = ANY($1)`, userIDs,
	)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var uid, onlineStatus string
		var showOnline bool
		if err := rows.Scan(&uid, &onlineStatus, &showOnline); err != nil {
			continue
		}
		if !showOnline || onlineStatus == "offline" || onlineStatus == "away" {
			result[uid] = false
		}
		// Don't set true — let the heartbeat-based status stand
	}
	return result, nil
}
