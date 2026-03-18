-- name: ListVoiceRooms :many
SELECT id, name, slug, created_at
FROM voice_rooms ORDER BY name;

-- name: ListVoicePresence :many
SELECT vp.id, vp.user_id, vp.room_slug, vp.joined_at,
       p.id AS profile_id, p.username AS profile_username, p.display_name AS profile_display_name,
       p.avatar_url AS profile_avatar_url, p.bio AS profile_bio, p.website AS profile_website,
       p.is_admin AS profile_is_admin, p.forumline_id AS profile_forumline_id,
       p.created_at AS profile_created_at, p.updated_at AS profile_updated_at
FROM voice_presence vp
JOIN profiles p ON p.id = vp.user_id;

-- name: SetVoicePresence :exec
INSERT INTO voice_presence (user_id, room_slug, joined_at)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE SET room_slug = $2, joined_at = $3;

-- name: ClearVoicePresence :one
DELETE FROM voice_presence WHERE user_id = $1 RETURNING room_slug;
