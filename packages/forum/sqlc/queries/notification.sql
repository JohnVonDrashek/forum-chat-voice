-- name: ListNotifications :many
SELECT id, user_id, type, title, message, link, read, created_at
FROM notifications
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: ListForumlineNotifications :many
SELECT id, type, title, message, link, read, created_at
FROM notifications
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: MarkNotificationRead :exec
UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2;

-- name: MarkAllNotificationsRead :exec
UPDATE notifications SET read = true WHERE user_id = $1 AND read = false;

-- name: InsertNotification :one
INSERT INTO notifications (user_id, type, title, message, link)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, read, created_at;

-- name: CountUnreadNotifications :one
SELECT COUNT(*)::int FROM notifications
WHERE user_id = $1 AND read = false AND type != 'chat_mention';

-- name: CountUnreadChatMentions :one
SELECT COUNT(*)::int FROM notifications
WHERE user_id = $1 AND read = false AND type = 'chat_mention';

-- name: GetThreadTitleAndAuthor :one
SELECT t.title, p.author_id FROM threads t
JOIN posts p ON p.thread_id = t.id
WHERE t.id = $1 ORDER BY p.created_at ASC LIMIT 1;
