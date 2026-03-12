package store

import (
	"context"
	"fmt"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
)

func (s *Store) GetCalleeFor1to1(ctx context.Context, userID, conversationID string) (string, error) {
	var calleeID string
	err := s.Pool.QueryRow(ctx,
		`SELECT cm2.user_id FROM forumline_conversations c
		 JOIN forumline_conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
		 JOIN forumline_conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != $1
		 WHERE c.id = $2 AND c.is_group = false
		 AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2`,
		userID, conversationID,
	).Scan(&calleeID)
	return calleeID, err
}

func (s *Store) HasActiveCall(ctx context.Context, conversationID string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE conversation_id = $1 AND status IN ('ringing', 'active'))`,
		conversationID,
	).Scan(&exists)
	return exists, err
}

func (s *Store) IsUserInCall(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('ringing', 'active'))`,
		userID,
	).Scan(&exists)
	return exists, err
}

func (s *Store) CreateCall(ctx context.Context, conversationID, callerID, calleeID string) (*model.CallRecord, error) {
	var call model.CallRecord
	var createdAt time.Time
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO forumline_calls (conversation_id, caller_id, callee_id, status)
		 VALUES ($1, $2, $3, 'ringing')
		 RETURNING id, conversation_id, caller_id, callee_id, status, created_at`,
		conversationID, callerID, calleeID,
	).Scan(&call.ID, &call.ConversationID, &call.CallerID, &call.CalleeID, &call.Status, &createdAt)
	if err != nil {
		return nil, err
	}
	call.CreatedAt = createdAt.Format(time.RFC3339)
	return &call, nil
}

func (s *Store) GetRingingCallCallerID(ctx context.Context, callID, calleeID string) (string, error) {
	var callerID string
	err := s.Pool.QueryRow(ctx,
		`SELECT caller_id FROM forumline_calls WHERE id = $1 AND callee_id = $2 AND status = 'ringing'`,
		callID, calleeID,
	).Scan(&callerID)
	return callerID, err
}

func (s *Store) AcceptCall(ctx context.Context, callID string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_calls SET status = 'active', started_at = now() WHERE id = $1`, callID)
	return err
}

func (s *Store) DeclineCall(ctx context.Context, callID string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_calls SET status = 'declined', ended_at = now() WHERE id = $1`, callID)
	return err
}

func (s *Store) EndCall(ctx context.Context, callID, userID string) (newStatus string, otherUserID string, err error) {
	var callerID, calleeID, status string
	var startedAt *time.Time
	err = s.Pool.QueryRow(ctx,
		`SELECT caller_id, callee_id, status, started_at FROM forumline_calls
		 WHERE id = $1 AND (caller_id = $2 OR callee_id = $2) AND status IN ('ringing', 'active')`,
		callID, userID,
	).Scan(&callerID, &calleeID, &status, &startedAt)
	if err != nil {
		return "", "", err
	}

	newStatus = "completed"
	if status == "ringing" {
		if userID == callerID {
			newStatus = "cancelled"
		} else {
			newStatus = "missed"
		}
	}

	var durationSQL string
	if status == "active" && startedAt != nil {
		durationSQL = ", duration_seconds = EXTRACT(EPOCH FROM now() - started_at)::integer"
	}

	_, err = s.Pool.Exec(ctx,
		fmt.Sprintf(`UPDATE forumline_calls SET status = $1, ended_at = now()%s WHERE id = $2`, durationSQL),
		newStatus, callID,
	)
	if err != nil {
		return "", "", err
	}

	otherUserID = calleeID
	if userID == calleeID {
		otherUserID = callerID
	}
	return newStatus, otherUserID, nil
}

func (s *Store) VerifyCallParticipants(ctx context.Context, callID, senderID, targetID string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_calls
		 WHERE id = $1 AND status IN ('ringing', 'active')
		 AND ((caller_id = $2 AND callee_id = $3) OR (caller_id = $3 AND callee_id = $2)))`,
		callID, senderID, targetID,
	).Scan(&exists)
	return exists, err
}

func (s *Store) CleanupStaleCalls(ctx context.Context) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE forumline_calls SET status = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'completed' END, ended_at = now()
		 WHERE status IN ('ringing', 'active')`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Store) NotifyCallSignal(ctx context.Context, payload string) error {
	_, err := s.Pool.Exec(ctx, "SELECT pg_notify('call_signal', $1)", payload)
	return err
}
