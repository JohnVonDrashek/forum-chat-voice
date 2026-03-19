-- name: GetCalleeFor1to1 :one
SELECT cm2.user_id FROM forumline_conversations c
JOIN forumline_conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = @user_id
JOIN forumline_conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != @user_id
WHERE c.id = @conversation_id AND c.is_group = false
AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2;

-- name: HasActiveCall :one
SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE conversation_id = $1 AND status IN ('ringing', 'active'));

-- name: IsUserInCall :one
SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('ringing', 'active'));

-- name: CreateCall :one
INSERT INTO forumline_calls (conversation_id, caller_id, callee_id, status)
VALUES ($1, $2, $3, 'ringing')
RETURNING id, conversation_id, caller_id, callee_id, status, created_at;

-- name: GetRingingCallCallerID :one
SELECT caller_id FROM forumline_calls WHERE id = $1 AND callee_id = $2 AND status = 'ringing';

-- name: AcceptCall :exec
UPDATE forumline_calls SET status = 'active', started_at = now() WHERE id = $1;

-- name: DeclineCall :exec
UPDATE forumline_calls SET status = 'declined', ended_at = now() WHERE id = $1;

-- name: GetCallForEnd :one
SELECT caller_id, callee_id, status, started_at FROM forumline_calls
WHERE id = @call_id AND (caller_id = @user_id OR callee_id = @user_id) AND status IN ('ringing', 'active');

-- name: EndCallWithDuration :exec
UPDATE forumline_calls SET status = $1, ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM now() - started_at)::integer
WHERE id = $2;

-- name: EndCallWithoutDuration :exec
UPDATE forumline_calls SET status = $1, ended_at = now() WHERE id = $2;

-- name: IsCallParticipant :one
SELECT EXISTS(SELECT 1 FROM forumline_calls
WHERE id = $1 AND (caller_id = $2 OR callee_id = $2) AND status IN ('ringing', 'active'));

-- name: CleanupStaleCalls :execrows
UPDATE forumline_calls SET status = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'completed' END, ended_at = now()
WHERE status IN ('ringing', 'active');
