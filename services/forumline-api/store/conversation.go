package store

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
)

func (s *Store) ListConversations(ctx context.Context, userID string) ([]model.Conversation, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT
			c.id, c.is_group, c.name,
			COALESCE(m.content, ''), COALESCE(m.created_at, c.created_at),
			(SELECT count(*) FROM forumline_direct_messages dm2
			 WHERE dm2.conversation_id = c.id
			   AND dm2.sender_id != $1
			   AND dm2.created_at > cm.last_read_at)
		 FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 LEFT JOIN LATERAL (
			SELECT content, created_at FROM forumline_direct_messages
			WHERE conversation_id = c.id
			ORDER BY created_at DESC LIMIT 1
		 ) m ON true
		 ORDER BY COALESCE(m.created_at, c.created_at) DESC
		 LIMIT 100`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type convoRow struct {
		id, lastMessage string
		isGroup         bool
		name            *string
		lastMessageTime time.Time
		unreadCount     int
	}

	var convoRows []convoRow
	var convoIDs []string
	for rows.Next() {
		var cr convoRow
		if err := rows.Scan(&cr.id, &cr.isGroup, &cr.name, &cr.lastMessage, &cr.lastMessageTime, &cr.unreadCount); err != nil {
			continue
		}
		convoRows = append(convoRows, cr)
		convoIDs = append(convoIDs, cr.id)
	}

	if len(convoIDs) == 0 {
		return []model.Conversation{}, nil
	}

	membersMap, err := s.fetchConversationMembers(ctx, convoIDs)
	if err != nil {
		return nil, err
	}

	conversations := make([]model.Conversation, 0, len(convoRows))
	for _, cr := range convoRows {
		members := membersMap[cr.id]
		if members == nil {
			members = []model.ConversationMember{}
		}
		conversations = append(conversations, model.Conversation{
			ID: cr.id, IsGroup: cr.isGroup, Name: cr.name,
			Members: members, LastMessage: cr.lastMessage,
			LastMessageTime: cr.lastMessageTime.Format(time.RFC3339),
			UnreadCount:     cr.unreadCount,
		})
	}
	return conversations, nil
}

func (s *Store) GetConversation(ctx context.Context, userID, conversationID string) (*model.Conversation, error) {
	var c model.Conversation
	var lastMessageTime time.Time
	err := s.Pool.QueryRow(ctx,
		`SELECT c.id, c.is_group, c.name,
			COALESCE(m.content, ''), COALESCE(m.created_at, c.created_at),
			(SELECT count(*) FROM forumline_direct_messages dm2
			 WHERE dm2.conversation_id = c.id AND dm2.sender_id != $1 AND dm2.created_at > cm.last_read_at)
		 FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 LEFT JOIN LATERAL (
			SELECT content, created_at FROM forumline_direct_messages
			WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
		 ) m ON true
		 WHERE c.id = $2`, userID, conversationID,
	).Scan(&c.ID, &c.IsGroup, &c.Name, &c.LastMessage, &lastMessageTime, &c.UnreadCount)
	if err != nil {
		return nil, err
	}
	c.LastMessageTime = lastMessageTime.Format(time.RFC3339)

	membersMap, err := s.fetchConversationMembers(ctx, []string{conversationID})
	if err != nil {
		return nil, err
	}
	c.Members = membersMap[conversationID]
	if c.Members == nil {
		c.Members = []model.ConversationMember{}
	}
	return &c, nil
}

func (s *Store) fetchConversationMembers(ctx context.Context, convoIDs []string) (map[string][]model.ConversationMember, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT cm.conversation_id, cm.user_id, p.username, p.display_name, p.avatar_url
		 FROM forumline_conversation_members cm
		 JOIN forumline_profiles p ON p.id = cm.user_id
		 WHERE cm.conversation_id = ANY($1)`, convoIDs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]model.ConversationMember)
	for rows.Next() {
		var convoID, userID, username, displayName string
		var avatarURL *string
		if err := rows.Scan(&convoID, &userID, &username, &displayName, &avatarURL); err != nil {
			continue
		}
		name := displayName
		if name == "" {
			name = username
		}
		result[convoID] = append(result[convoID], model.ConversationMember{
			ID: userID, Username: username, DisplayName: name, AvatarURL: avatarURL,
		})
	}
	return result, nil
}

func (s *Store) IsConversationMember(ctx context.Context, conversationID, userID string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2)`,
		conversationID, userID,
	).Scan(&exists)
	return exists, err
}

func (s *Store) GetMessages(ctx context.Context, conversationID, before string, limitStr string) ([]model.DirectMessage, error) {
	limit := 50
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = int(math.Min(float64(l), 100))
	}

	var messages []model.DirectMessage

	if before != "" {
		rows, err := s.Pool.Query(ctx,
			`SELECT id, conversation_id, sender_id, content, created_at
			 FROM forumline_direct_messages
			 WHERE conversation_id = $1 AND created_at < (SELECT created_at FROM forumline_direct_messages WHERE id = $2)
			 ORDER BY created_at DESC LIMIT $3`, conversationID, before, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var msg model.DirectMessage
			if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt); err != nil {
				continue
			}
			messages = append(messages, msg)
		}
	} else {
		rows, err := s.Pool.Query(ctx,
			`SELECT id, conversation_id, sender_id, content, created_at
			 FROM forumline_direct_messages
			 WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`, conversationID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var msg model.DirectMessage
			if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt); err != nil {
				continue
			}
			messages = append(messages, msg)
		}
	}

	// Reverse to chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	if messages == nil {
		messages = []model.DirectMessage{}
	}
	return messages, nil
}

func (s *Store) SendMessage(ctx context.Context, conversationID, senderID, content string) (*model.DirectMessage, error) {
	var msg model.DirectMessage
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO forumline_direct_messages (conversation_id, sender_id, content)
		 VALUES ($1, $2, $3)
		 RETURNING id, conversation_id, sender_id, content, created_at`,
		conversationID, senderID, content,
	).Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt)
	if err != nil {
		return nil, err
	}
	// Update conversation timestamp
	_, _ = s.Pool.Exec(ctx, `UPDATE forumline_conversations SET updated_at = now() WHERE id = $1`, conversationID)
	return &msg, nil
}

func (s *Store) MarkRead(ctx context.Context, conversationID, userID string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_conversation_members SET last_read_at = now()
		 WHERE conversation_id = $1 AND user_id = $2`, conversationID, userID,
	)
	return err
}

func (s *Store) FindOrCreate1to1Conversation(ctx context.Context, userID, otherUserID string) (string, error) {
	// Try to find existing
	var convoID string
	err := s.Pool.QueryRow(ctx,
		`SELECT c.id FROM forumline_conversations c
		 WHERE c.is_group = false
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $1)
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $2)
		   AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2`,
		userID, otherUserID,
	).Scan(&convoID)
	if err == nil {
		return convoID, nil
	}

	// Create new
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	err = tx.QueryRow(ctx,
		`INSERT INTO forumline_conversations (is_group, created_by) VALUES (false, $1) RETURNING id`, userID,
	).Scan(&convoID)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
		convoID, userID, otherUserID,
	)
	if err != nil {
		return "", err
	}

	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return convoID, nil
}

func (s *Store) CreateGroupConversation(ctx context.Context, name, creatorID string, memberIDs []string) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var convoID string
	err = tx.QueryRow(ctx,
		`INSERT INTO forumline_conversations (is_group, name, created_by) VALUES (true, $1, $2) RETURNING id`,
		name, creatorID,
	).Scan(&convoID)
	if err != nil {
		return "", err
	}

	// Batch insert members
	valueStrings := make([]string, len(memberIDs))
	args := make([]interface{}, 0, len(memberIDs)+1)
	args = append(args, convoID)
	for i, id := range memberIDs {
		valueStrings[i] = fmt.Sprintf("($1, $%d)", i+2)
		args = append(args, id)
	}
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES %s`,
			strings.Join(valueStrings, ",")),
		args...,
	)
	if err != nil {
		return "", err
	}

	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return convoID, nil
}

func (s *Store) IsGroupConversation(ctx context.Context, conversationID, userID string) (bool, error) {
	var isGroup bool
	err := s.Pool.QueryRow(ctx,
		`SELECT c.is_group FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 WHERE c.id = $2`, userID, conversationID,
	).Scan(&isGroup)
	return isGroup, err
}

func (s *Store) UpdateConversationName(ctx context.Context, conversationID, name string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE forumline_conversations SET name = $1 WHERE id = $2`, name, conversationID)
	return err
}

func (s *Store) AddConversationMembers(ctx context.Context, conversationID string, memberIDs []string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_conversation_members (conversation_id, user_id)
		 SELECT $1, p.id FROM forumline_profiles p WHERE p.id = ANY($2)
		 ON CONFLICT DO NOTHING`, conversationID, memberIDs)
	return err
}

func (s *Store) RemoveConversationMembers(ctx context.Context, conversationID string, memberIDs []string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = ANY($2)`,
		conversationID, memberIDs)
	return err
}

func (s *Store) LeaveConversation(ctx context.Context, conversationID, userID string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2`,
		conversationID, userID)
	return err
}

func (s *Store) CountExistingUsers(ctx context.Context, userIDs []string) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM forumline_profiles WHERE id = ANY($1)`, userIDs,
	).Scan(&count)
	return count, err
}
