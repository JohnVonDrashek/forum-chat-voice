package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/forumline/forumline/services/forumline-api/sqlcdb"
)

type NotificationRow struct {
	ID          uuid.UUID `json:"id"`
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

func (s *Store) InsertNotification(ctx context.Context, userID, forumDomain, forumName, notifType, title, body, link string) (uuid.UUID, time.Time, error) {
	row, err := s.Q.InsertNotification(ctx, sqlcdb.InsertNotificationParams{
		UserID:      userID,
		ForumDomain: forumDomain,
		ForumName:   forumName,
		Type:        notifType,
		Title:       title,
		Body:        body,
		Link:        link,
	})
	if err != nil {
		return uuid.UUID{}, time.Time{}, err
	}
	return row.ID, row.CreatedAt, nil
}

func (s *Store) ListNotifications(ctx context.Context, userID string, limit int) ([]NotificationRow, error) {
	rows, err := s.Q.ListNotifications(ctx, sqlcdb.ListNotificationsParams{
		UserID: userID,
		Limit:  int32(min(limit, 1000)), //nolint:gosec // limit is bounded
	})
	if err != nil {
		return nil, err
	}

	notifs := make([]NotificationRow, 0, len(rows))
	for _, r := range rows {
		notifs = append(notifs, NotificationRow{
			ID:          r.ID,
			ForumDomain: r.ForumDomain,
			ForumName:   r.ForumName,
			Type:        r.Type,
			Title:       r.Title,
			Body:        r.Body,
			Link:        r.Link,
			Read:        r.Read,
			CreatedAt:   r.CreatedAt.Format(time.RFC3339),
		})
	}
	if len(notifs) == 0 {
		notifs = []NotificationRow{}
	}
	return notifs, nil
}

func (s *Store) MarkNotificationRead(ctx context.Context, notifID uuid.UUID, userID string) error {
	return s.Q.MarkNotificationRead(ctx, sqlcdb.MarkNotificationReadParams{
		ID:     notifID,
		UserID: userID,
	})
}

func (s *Store) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	return s.Q.MarkAllNotificationsRead(ctx, userID)
}

func (s *Store) CountUnreadNotifications(ctx context.Context, userID string) (int, error) {
	count, err := s.Q.CountUnreadNotifications(ctx, userID)
	return int(count), err
}

func (s *Store) IsNotificationsMutedByDomain(ctx context.Context, userID, forumDomain string) (bool, error) {
	muted, err := s.Q.IsNotificationsMutedByDomain(ctx, sqlcdb.IsNotificationsMutedByDomainParams{
		UserID: userID,
		Domain: forumDomain,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return muted, nil
}

func (s *Store) GetForumNameByDomain(ctx context.Context, domain string) (string, error) {
	return s.Q.GetForumNameByDomain(ctx, domain)
}
