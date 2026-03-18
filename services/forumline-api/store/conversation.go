package store

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/sqlcdb"
)

func (s *Store) ListConversations(ctx context.Context, userID string) ([]oapi.Conversation, error) {
	rows, err := s.Q.ListConversations(ctx, userID)
	if err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return []oapi.Conversation{}, nil
	}

	convoIDs := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		convoIDs[i] = r.ID
	}

	membersMap, err := s.fetchConversationMembers(ctx, convoIDs)
	if err != nil {
		return nil, err
	}

	conversations := make([]oapi.Conversation, 0, len(rows))
	for _, r := range rows {
		members := membersMap[r.ID]
		if members == nil {
			members = []oapi.ConversationMember{}
		}
		conversations = append(conversations, oapi.Conversation{
			Id: r.ID, IsGroup: r.IsGroup, Name: r.Name,
			Members: members, LastMessage: r.LastMessage,
			LastMessageTime: r.LastMessageTime.Format(time.RFC3339),
			UnreadCount:     int(r.UnreadCount),
		})
	}
	return conversations, nil
}

func (s *Store) GetConversation(ctx context.Context, userID string, conversationID uuid.UUID) (*oapi.Conversation, error) {
	row, err := s.Q.GetConversation(ctx, sqlcdb.GetConversationParams{
		UserID:         userID,
		ConversationID: conversationID,
	})
	if err != nil {
		return nil, err
	}

	membersMap, err := s.fetchConversationMembers(ctx, []uuid.UUID{conversationID})
	if err != nil {
		return nil, err
	}
	members := membersMap[conversationID]
	if members == nil {
		members = []oapi.ConversationMember{}
	}
	return &oapi.Conversation{
		Id: row.ID, IsGroup: row.IsGroup, Name: row.Name,
		Members: members, LastMessage: row.LastMessage,
		LastMessageTime: row.LastMessageTime.Format(time.RFC3339),
		UnreadCount:     int(row.UnreadCount),
	}, nil
}

func (s *Store) fetchConversationMembers(ctx context.Context, convoIDs []uuid.UUID) (map[uuid.UUID][]oapi.ConversationMember, error) {
	rows, err := s.Q.FetchConversationMembers(ctx, convoIDs)
	if err != nil {
		return nil, err
	}

	result := make(map[uuid.UUID][]oapi.ConversationMember)
	for _, r := range rows {
		name := r.DisplayName
		if name == "" {
			name = r.Username
		}
		result[r.ConversationID] = append(result[r.ConversationID], oapi.ConversationMember{
			Id: r.UserID, Username: r.Username, DisplayName: name, AvatarUrl: r.AvatarUrl,
		})
	}
	return result, nil
}

func (s *Store) IsConversationMember(ctx context.Context, conversationID uuid.UUID, userID string) (bool, error) {
	return s.Q.IsConversationMember(ctx, sqlcdb.IsConversationMemberParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
}

func (s *Store) GetMessages(ctx context.Context, conversationID uuid.UUID, before string, limitStr string) ([]oapi.DirectMessage, error) {
	limit := 50
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = int(math.Min(float64(l), 100))
	}

	var dbMessages []sqlcdb.ForumlineDirectMessage

	if before != "" {
		beforeID, err := uuid.Parse(before)
		if err != nil {
			return nil, fmt.Errorf("invalid before cursor: %w", err)
		}
		rows, err := s.Q.GetMessagesBefore(ctx, sqlcdb.GetMessagesBeforeParams{
			ConversationID: conversationID,
			BeforeID:       beforeID,
			MsgLimit:       int32(min(limit, 1000)), //nolint:gosec // bounded
		})
		if err != nil {
			return nil, err
		}
		dbMessages = rows
	} else {
		rows, err := s.Q.GetMessagesLatest(ctx, sqlcdb.GetMessagesLatestParams{
			ConversationID: conversationID,
			Limit:          int32(min(limit, 1000)), //nolint:gosec // bounded
		})
		if err != nil {
			return nil, err
		}
		dbMessages = rows
	}

	messages := make([]oapi.DirectMessage, len(dbMessages))
	for i, m := range dbMessages {
		messages[i] = oapi.DirectMessage{
			Id:             m.ID,
			ConversationId: m.ConversationID,
			SenderId:       m.SenderID,
			Content:        m.Content,
			CreatedAt:      m.CreatedAt,
		}
	}

	// Reverse to chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, nil
}

func (s *Store) SendMessage(ctx context.Context, conversationID uuid.UUID, senderID, content string) (*oapi.DirectMessage, error) {
	row, err := s.Q.SendMessage(ctx, sqlcdb.SendMessageParams{
		ConversationID: conversationID,
		SenderID:       senderID,
		Content:        content,
	})
	if err != nil {
		return nil, err
	}
	// Update conversation timestamp (fire-and-forget)
	_ = s.Q.TouchConversation(ctx, conversationID)
	return &oapi.DirectMessage{
		Id:             row.ID,
		ConversationId: row.ConversationID,
		SenderId:       row.SenderID,
		Content:        row.Content,
		CreatedAt:      row.CreatedAt,
	}, nil
}

func (s *Store) MarkRead(ctx context.Context, conversationID uuid.UUID, userID string) error {
	return s.Q.MarkRead(ctx, sqlcdb.MarkReadParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
}

func (s *Store) FindOrCreate1to1Conversation(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	// Try to find existing
	id, err := s.Q.Find1to1Conversation(ctx, sqlcdb.Find1to1ConversationParams{
		UserID:      userID,
		OtherUserID: otherUserID,
	})
	if err == nil {
		return id, nil
	}

	// Create new (needs transaction)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := s.Q.WithTx(tx)

	convoID, err := qtx.CreateConversation(ctx, sqlcdb.CreateConversationParams{
		IsGroup:   false,
		CreatedBy: &userID,
	})
	if err != nil {
		return uuid.UUID{}, err
	}

	err = qtx.Insert1to1Members(ctx, sqlcdb.Insert1to1MembersParams{
		ConversationID: convoID,
		UserID:         userID,
		UserID_2:       otherUserID,
	})
	if err != nil {
		return uuid.UUID{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return convoID, nil
}

// CreateGroupConversation uses dynamic SQL for batch member insert — stays hand-written.
func (s *Store) CreateGroupConversation(ctx context.Context, name, creatorID string, memberIDs []string) (uuid.UUID, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := s.Q.WithTx(tx)

	convoID, err := qtx.CreateConversation(ctx, sqlcdb.CreateConversationParams{
		IsGroup:   true,
		Name:      &name,
		CreatedBy: &creatorID,
	})
	if err != nil {
		return uuid.UUID{}, err
	}

	// Batch insert members (dynamic VALUES — can't be sqlc'd)
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
		return uuid.UUID{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return convoID, nil
}

func (s *Store) IsGroupConversation(ctx context.Context, conversationID uuid.UUID, userID string) (bool, error) {
	return s.Q.IsGroupConversation(ctx, sqlcdb.IsGroupConversationParams{
		UserID:         userID,
		ConversationID: conversationID,
	})
}

func (s *Store) UpdateConversationName(ctx context.Context, conversationID uuid.UUID, name string) error {
	return s.Q.UpdateConversationName(ctx, sqlcdb.UpdateConversationNameParams{
		Name: &name,
		ID:   conversationID,
	})
}

func (s *Store) AddConversationMembers(ctx context.Context, conversationID uuid.UUID, memberIDs []string) error {
	return s.Q.AddConversationMembers(ctx, sqlcdb.AddConversationMembersParams{
		ConversationID: conversationID,
		MemberIds:      memberIDs,
	})
}

func (s *Store) RemoveConversationMembers(ctx context.Context, conversationID uuid.UUID, memberIDs []string) error {
	return s.Q.RemoveConversationMembers(ctx, sqlcdb.RemoveConversationMembersParams{
		ConversationID: conversationID,
		MemberIds:      memberIDs,
	})
}

func (s *Store) GetConversationMemberIDs(ctx context.Context, conversationID uuid.UUID) ([]string, error) {
	return s.Q.GetConversationMemberIDs(ctx, conversationID)
}

func (s *Store) LeaveConversation(ctx context.Context, conversationID uuid.UUID, userID string) error {
	return s.Q.LeaveConversation(ctx, sqlcdb.LeaveConversationParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
}
