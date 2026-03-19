-- name: ListMemberships :many
SELECT m.id, m.joined_at, m.forum_authed_at, m.notifications_muted,
       f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities,
       f.member_count
FROM forumline_memberships m
JOIN forumline_forums f ON f.id = m.forum_id
WHERE m.user_id = $1
ORDER BY m.joined_at DESC;

-- name: UpsertMembership :exec
INSERT INTO forumline_memberships (user_id, forum_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteMembership :exec
DELETE FROM forumline_memberships WHERE user_id = $1 AND forum_id = $2;

-- name: SetMembershipAuthed :exec
UPDATE forumline_memberships SET forum_authed_at = now() WHERE user_id = $1 AND forum_id = $2;

-- name: ClearMembershipAuthed :exec
UPDATE forumline_memberships SET forum_authed_at = NULL WHERE user_id = $1 AND forum_id = $2;

-- name: UpdateMembershipMute :exec
UPDATE forumline_memberships SET notifications_muted = $1 WHERE user_id = $2 AND forum_id = $3;

-- name: GetMembershipJoinDetails :one
SELECT f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities, m.joined_at,
       (SELECT COUNT(*)::int FROM forumline_memberships WHERE forum_id = f.id) AS member_count
FROM forumline_forums f
JOIN forumline_memberships m ON m.forum_id = f.id
WHERE f.id = $1 AND m.user_id = $2;
