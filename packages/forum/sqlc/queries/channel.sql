-- name: ListChannels :many
SELECT id, name, slug, description, created_at
FROM chat_channels ORDER BY name;

-- name: GetChannelIDBySlug :one
SELECT id FROM chat_channels WHERE slug = $1;

-- name: ListChatMessages :many
SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at,
       p.id AS author_id_2, p.username AS author_username, p.display_name AS author_display_name,
       p.avatar_url AS author_avatar_url, p.bio AS author_bio, p.website AS author_website,
       p.is_admin AS author_is_admin, p.forumline_id AS author_forumline_id,
       p.created_at AS author_created_at, p.updated_at AS author_updated_at
FROM chat_messages m
JOIN chat_channels ch ON ch.id = m.channel_id
JOIN profiles p ON p.id = m.author_id
WHERE ch.slug = $1
ORDER BY m.created_at ASC
LIMIT 100;

-- name: InsertChatMessage :one
INSERT INTO chat_messages (channel_id, author_id, content) VALUES ($1, $2, $3)
RETURNING id, created_at;
