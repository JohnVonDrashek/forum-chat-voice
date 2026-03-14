package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type NotificationRow struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	ForumDomain string `json:"forum_domain"`
	ForumName   string `json:"forum_name"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	Link        string `json:"link"`
	Read        bool   `json:"read"`
	CreatedAt   string `json:"created_at"`
}

func (s *Store) InsertNotification(ctx context.Context, userID, forumDomain, forumName, notifType, title, body, link string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_notifications (user_id, forum_domain, forum_name, type, title, body, link)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		userID, forumDomain, forumName, notifType, title, body, link)
	return err
}

func (s *Store) ListNotifications(ctx context.Context, userID string, limit int) ([]NotificationRow, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT id, forum_domain, forum_name, type, title, body, link, read, created_at
		 FROM forumline_notifications
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifs []NotificationRow
	for rows.Next() {
		var n NotificationRow
		var createdAt time.Time
		if err := rows.Scan(&n.ID, &n.ForumDomain, &n.ForumName, &n.Type, &n.Title, &n.Body, &n.Link, &n.Read, &createdAt); err != nil {
			continue
		}
		n.CreatedAt = createdAt.Format(time.RFC3339)
		notifs = append(notifs, n)
	}
	if notifs == nil {
		notifs = []NotificationRow{}
	}
	return notifs, nil
}

func (s *Store) MarkNotificationRead(ctx context.Context, notifID, userID string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_notifications SET read = true WHERE id = $1 AND user_id = $2`,
		notifID, userID)
	return err
}

func (s *Store) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_notifications SET read = true WHERE user_id = $1 AND read = false`,
		userID)
	return err
}

func (s *Store) CountUnreadNotifications(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM forumline_notifications WHERE user_id = $1 AND read = false`,
		userID).Scan(&count)
	return count, err
}

func (s *Store) IsNotificationsMutedByDomain(ctx context.Context, userID, forumDomain string) (bool, error) {
	var muted bool
	err := s.Pool.QueryRow(ctx,
		`SELECT m.notifications_muted
		 FROM forumline_memberships m
		 JOIN forumline_forums f ON f.id = m.forum_id
		 WHERE m.user_id = $1 AND f.domain = $2`,
		userID, forumDomain).Scan(&muted)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return muted, nil
}

func (s *Store) GetForumNameByDomain(ctx context.Context, domain string) (string, error) {
	var name string
	err := s.Pool.QueryRow(ctx,
		`SELECT name FROM forumline_forums WHERE domain = $1`, domain).Scan(&name)
	return name, err
}

func (s *Store) UserExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1)`, userID).Scan(&exists)
	return exists, err
}
