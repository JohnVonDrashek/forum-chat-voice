-- READ-ONLY: profiles are owned by the hub service.

-- name: GetProfile :one
SELECT id, username, display_name, avatar_url, bio, status_message, online_status, show_online_status
FROM forumline_profiles WHERE id = $1;

-- name: ProfileExists :one
SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1);

-- name: FetchProfilesByIDs :many
SELECT id, username, display_name, avatar_url
FROM forumline_profiles WHERE id = ANY($1::text[]);

-- name: SearchProfiles :many
SELECT id, username, display_name, avatar_url
FROM forumline_profiles
WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2)
LIMIT 10;

-- name: GetSenderUsername :one
SELECT username FROM forumline_profiles WHERE id = $1;

-- name: GetOnlineStatusPreferences :many
SELECT id, online_status, show_online_status
FROM forumline_profiles WHERE id = ANY($1::text[]);

-- name: CountExistingUsers :one
SELECT count(*) FROM forumline_profiles WHERE id = ANY($1::text[]);

-- name: GetForumIDByDomain :one
SELECT id FROM forumline_forums WHERE domain = $1;

-- name: GetForumNameByDomain :one
SELECT name FROM forumline_forums WHERE domain = $1;

-- name: IsNotificationsMuted :one
SELECT notifications_muted FROM forumline_memberships WHERE user_id = $1 AND forum_id = $2;

-- name: IsNotificationsMutedByDomain :one
SELECT m.notifications_muted
FROM forumline_memberships m
JOIN forumline_forums f ON f.id = m.forum_id
WHERE m.user_id = $1 AND f.domain = $2;
