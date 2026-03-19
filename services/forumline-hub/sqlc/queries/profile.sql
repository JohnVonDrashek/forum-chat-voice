-- name: GetProfile :one
SELECT id, username, display_name, avatar_url, bio, status_message, online_status, show_online_status
FROM forumline_profiles WHERE id = $1;

-- name: CreateProfile :exec
INSERT INTO forumline_profiles (id, username, display_name, avatar_url) VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO NOTHING;

-- name: UsernameExists :one
SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE username = $1);

-- name: DeleteUser :exec
DELETE FROM forumline_profiles WHERE id = $1;

-- name: SearchProfiles :many
SELECT id, username, display_name, avatar_url
FROM forumline_profiles
WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2)
LIMIT 10;

-- name: ProfileExists :one
SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1);
