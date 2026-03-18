package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/forum/oapi"
	"github.com/forumline/forumline/forum/sqlcdb"
)

// ListNotifications returns notifications for a user (data provider format).
func (s *Store) ListNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]oapi.Notification, error) {
	rows, err := s.Q.ListNotifications(ctx, sqlcdb.ListNotificationsParams{
		UserID: userID,
		Limit:  int32(min(limit, 1000)), //nolint:gosec // limit is bounded
	})
	if err != nil {
		return nil, err
	}
	notifications := make([]oapi.Notification, 0, len(rows))
	for _, r := range rows {
		notifications = append(notifications, oapi.Notification{
			Id:        r.ID,
			UserId:    r.UserID,
			Type:      r.Type,
			Title:     r.Title,
			Message:   r.Message,
			Link:      r.Link,
			Read:      r.Read,
			CreatedAt: r.CreatedAt,
		})
	}
	return notifications, nil
}

// ListForumlineNotifications returns notifications in the forumline protocol format.
func (s *Store) ListForumlineNotifications(ctx context.Context, userID uuid.UUID, limit int, forumDomain string) ([]oapi.ForumlineNotification, error) {
	rows, err := s.Q.ListForumlineNotifications(ctx, sqlcdb.ListForumlineNotificationsParams{
		UserID: userID,
		Limit:  int32(min(limit, 1000)), //nolint:gosec // limit is bounded
	})
	if err != nil {
		return nil, err
	}
	notifications := make([]oapi.ForumlineNotification, 0, len(rows))
	for _, r := range rows {
		link := "/"
		if r.Link != nil {
			link = *r.Link
		}
		notifications = append(notifications, oapi.ForumlineNotification{
			Id:          r.ID,
			Type:        r.Type,
			Title:       r.Title,
			Body:        r.Message,
			Link:        link,
			Read:        r.Read,
			Timestamp:   r.CreatedAt,
			ForumDomain: forumDomain,
		})
	}
	return notifications, nil
}

// MarkNotificationRead marks a single notification as read.
func (s *Store) MarkNotificationRead(ctx context.Context, notifID, userID uuid.UUID) error {
	return s.Q.MarkNotificationRead(ctx, sqlcdb.MarkNotificationReadParams{
		ID:     notifID,
		UserID: userID,
	})
}

// MarkAllNotificationsRead marks all notifications as read for a user.
func (s *Store) MarkAllNotificationsRead(ctx context.Context, userID uuid.UUID) error {
	return s.Q.MarkAllNotificationsRead(ctx, userID)
}

// InsertNotification inserts a notification and returns its id and created_at.
func (s *Store) InsertNotification(ctx context.Context, userID uuid.UUID, notifType, title, message, link string) (uuid.UUID, time.Time, error) {
	row, err := s.Q.InsertNotification(ctx, sqlcdb.InsertNotificationParams{
		UserID:  userID,
		Type:    notifType,
		Title:   title,
		Message: message,
		Link:    &link,
	})
	if err != nil {
		return uuid.UUID{}, time.Time{}, err
	}
	return row.ID, row.CreatedAt, nil
}

// CountUnread returns unread notification and chat_mention counts.
func (s *Store) CountUnread(ctx context.Context, userID uuid.UUID) (notifs int, chatMentions int, err error) {
	n, err := s.Q.CountUnreadNotifications(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	c, err := s.Q.CountUnreadChatMentions(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	return int(n), int(c), nil
}

// GetThreadTitleAndAuthor returns the thread title and OP author UUID.
func (s *Store) GetThreadTitleAndAuthor(ctx context.Context, threadID uuid.UUID) (title string, authorID uuid.UUID, err error) {
	row, err := s.Q.GetThreadTitleAndAuthor(ctx, threadID)
	if err != nil {
		return "", uuid.UUID{}, err
	}
	return row.Title, row.AuthorID, nil
}
