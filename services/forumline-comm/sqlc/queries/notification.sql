-- name: InsertNotification :one
INSERT INTO forumline_notifications (user_id, forum_domain, forum_name, type, title, body, link)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, read, created_at;

-- name: ListNotifications :many
SELECT id, forum_domain, forum_name, type, title, body, link, read, created_at
FROM forumline_notifications
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: MarkNotificationRead :exec
UPDATE forumline_notifications SET read = true WHERE id = $1 AND user_id = $2;

-- name: MarkAllNotificationsRead :exec
UPDATE forumline_notifications SET read = true WHERE user_id = $1 AND read = false;

-- name: CountUnreadNotifications :one
SELECT COUNT(*)::int FROM forumline_notifications WHERE user_id = $1 AND read = false;
