-- name: ListConversations :many
SELECT
    c.id, c.is_group, c.name,
    COALESCE(m.content, '') AS last_message,
    COALESCE(m.created_at, c.created_at) AS last_message_time,
    (SELECT count(*) FROM forumline_direct_messages dm2
     WHERE dm2.conversation_id = c.id
       AND dm2.sender_id != @user_id
       AND dm2.created_at > cm.last_read_at)::int AS unread_count
FROM forumline_conversations c
JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id
LEFT JOIN LATERAL (
    SELECT content, created_at FROM forumline_direct_messages
    WHERE conversation_id = c.id
    ORDER BY created_at DESC LIMIT 1
) m ON true
ORDER BY COALESCE(m.created_at, c.created_at) DESC
LIMIT 100;

-- name: GetConversation :one
SELECT c.id, c.is_group, c.name,
    COALESCE(m.content, '') AS last_message,
    COALESCE(m.created_at, c.created_at) AS last_message_time,
    (SELECT count(*) FROM forumline_direct_messages dm2
     WHERE dm2.conversation_id = c.id AND dm2.sender_id != @user_id AND dm2.created_at > cm.last_read_at)::int AS unread_count
FROM forumline_conversations c
JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id
LEFT JOIN LATERAL (
    SELECT content, created_at FROM forumline_direct_messages
    WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
) m ON true
WHERE c.id = @conversation_id;

-- name: FetchConversationMembers :many
SELECT cm.conversation_id, cm.user_id, p.username, p.display_name, p.avatar_url
FROM forumline_conversation_members cm
JOIN forumline_profiles p ON p.id = cm.user_id
WHERE cm.conversation_id = ANY(@conversation_ids::uuid[]);

-- name: GetConversationMemberIDs :many
SELECT user_id FROM forumline_conversation_members WHERE conversation_id = $1;

-- name: IsConversationMember :one
SELECT EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2);

-- name: GetMessagesBefore :many
SELECT dm.id, dm.conversation_id, dm.sender_id, dm.content, dm.created_at
FROM forumline_direct_messages dm
WHERE dm.conversation_id = @conversation_id AND dm.created_at < (SELECT dm2.created_at FROM forumline_direct_messages dm2 WHERE dm2.id = @before_id)
ORDER BY dm.created_at DESC LIMIT @msg_limit;

-- name: GetMessagesLatest :many
SELECT id, conversation_id, sender_id, content, created_at
FROM forumline_direct_messages
WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2;

-- name: SendMessage :one
INSERT INTO forumline_direct_messages (conversation_id, sender_id, content)
VALUES ($1, $2, $3)
RETURNING id, conversation_id, sender_id, content, created_at;

-- name: TouchConversation :exec
UPDATE forumline_conversations SET updated_at = now() WHERE id = $1;

-- name: MarkRead :exec
UPDATE forumline_conversation_members SET last_read_at = now()
WHERE conversation_id = $1 AND user_id = $2;

-- name: Find1to1Conversation :one
SELECT c.id FROM forumline_conversations c
WHERE c.is_group = false
  AND EXISTS(SELECT 1 FROM forumline_conversation_members cm1 WHERE cm1.conversation_id = c.id AND cm1.user_id = @user_id)
  AND EXISTS(SELECT 1 FROM forumline_conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = @other_user_id)
  AND (SELECT count(*) FROM forumline_conversation_members cm3 WHERE cm3.conversation_id = c.id) = 2;

-- name: CreateConversation :one
INSERT INTO forumline_conversations (is_group, name, created_by) VALUES ($1, $2, $3) RETURNING id;

-- name: InsertConversationMember :exec
INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES ($1, $2);

-- name: Insert1to1Members :exec
INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3);

-- name: IsGroupConversation :one
SELECT c.is_group FROM forumline_conversations c
JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id
WHERE c.id = @conversation_id;

-- name: UpdateConversationName :exec
UPDATE forumline_conversations SET name = $1 WHERE id = $2;

-- name: AddConversationMembers :exec
INSERT INTO forumline_conversation_members (conversation_id, user_id)
SELECT $1, p.id FROM forumline_profiles p WHERE p.id = ANY(@member_ids::text[])
ON CONFLICT DO NOTHING;

-- name: RemoveConversationMembers :exec
DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = ANY(@member_ids::text[]);

-- name: LeaveConversation :exec
DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2;
