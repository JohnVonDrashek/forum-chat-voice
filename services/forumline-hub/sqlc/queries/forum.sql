-- name: ListForumTags :many
SELECT DISTINCT unnest(tags) AS tag
FROM forumline_forums WHERE approved = true AND array_length(capabilities, 1) > 0
ORDER BY tag;

-- name: ListRecommendedForums :many
WITH my_forums AS (
    SELECT ms.forum_id FROM forumline_memberships ms WHERE ms.user_id = @user_id
),
forum_mates AS (
    SELECT DISTINCT m.user_id
    FROM forumline_memberships m
    JOIN my_forums mf ON m.forum_id = mf.forum_id
    WHERE m.user_id != @user_id
)
SELECT f.id, f.domain, f.name, f.icon_url, f.api_base, f.web_base,
       f.capabilities, f.description, f.screenshot_url, f.tags, f.member_count,
       COUNT(m2.user_id)::int AS shared_member_count
FROM forumline_memberships m2
JOIN forum_mates fm ON m2.user_id = fm.user_id
JOIN forumline_forums f ON f.id = m2.forum_id
WHERE f.approved = true
  AND f.id NOT IN (SELECT mf2.forum_id FROM my_forums mf2)
GROUP BY f.id
ORDER BY shared_member_count DESC, f.member_count DESC
LIMIT 10;

-- name: GetForumIDByDomain :one
SELECT id FROM forumline_forums WHERE domain = $1;

-- name: GetForumDomainByID :one
SELECT domain FROM forumline_forums WHERE id = $1;

-- name: GetForumName :one
SELECT COALESCE(name, domain) AS name FROM forumline_forums WHERE id = $1;

-- name: RegisterForum :one
INSERT INTO forumline_forums (domain, name, api_base, web_base, capabilities, description, tags, owner_id, approved)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
RETURNING id;

-- name: UpsertForumFromManifest :one
INSERT INTO forumline_forums (domain, name, icon_url, api_base, web_base, capabilities, tags, approved)
VALUES ($1, $2, $3, $4, $5, $6, $7, false)
ON CONFLICT (domain) DO UPDATE SET
  name = EXCLUDED.name, icon_url = EXCLUDED.icon_url,
  api_base = EXCLUDED.api_base, web_base = EXCLUDED.web_base,
  capabilities = EXCLUDED.capabilities, tags = EXCLUDED.tags
WHERE forumline_forums.approved = false
RETURNING id;

-- name: CountForumsByOwner :one
SELECT COUNT(*)::int FROM forumline_forums WHERE owner_id = $1;

-- name: DomainExists :one
SELECT EXISTS(SELECT 1 FROM forumline_forums WHERE domain = $1);

-- name: ListOwnedForums :many
SELECT id, domain, name, icon_url, api_base, web_base, approved,
       member_count, last_seen_at, consecutive_failures, created_at
FROM forumline_forums WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: GetForumOwner :one
SELECT owner_id FROM forumline_forums WHERE id = $1;

-- name: DeleteForum :execrows
DELETE FROM forumline_forums WHERE id = $1 AND owner_id = $2;

-- name: DeleteForumByID :exec
DELETE FROM forumline_forums WHERE id = $1;

-- name: CountForumMembers :one
SELECT COUNT(*)::int FROM forumline_memberships WHERE forum_id = $1;

-- name: UpdateForumScreenshot :execrows
UPDATE forumline_forums SET screenshot_url = $1, updated_at = now() WHERE domain = $2;

-- name: UpdateForumIcon :execrows
UPDATE forumline_forums SET icon_url = $1, updated_at = now() WHERE domain = $2;

-- name: MarkForumHealthy :execrows
UPDATE forumline_forums SET last_seen_at = now(), consecutive_failures = 0 WHERE domain = $1;

-- name: ReapproveHealthyForum :exec
UPDATE forumline_forums SET approved = true
WHERE domain = $1 AND approved = false AND consecutive_failures = 0 AND owner_id IS NOT NULL;

-- name: IncrementForumFailures :one
UPDATE forumline_forums SET consecutive_failures = consecutive_failures + 1
WHERE domain = $1 RETURNING consecutive_failures, owner_id;

-- name: DelistForum :execrows
UPDATE forumline_forums SET approved = false WHERE domain = $1 AND approved = true;

-- name: AutoDeleteUnownedForum :execrows
DELETE FROM forumline_forums WHERE domain = $1 AND owner_id IS NULL;

-- name: ListAllForums :many
SELECT id, domain, name, icon_url, api_base, web_base, capabilities, approved, owner_id,
       last_seen_at, consecutive_failures
FROM forumline_forums ORDER BY domain;

-- name: GetForumNameByDomain :one
SELECT name FROM forumline_forums WHERE domain = $1;
