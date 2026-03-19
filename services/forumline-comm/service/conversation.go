package service

import (
	"context"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
)

type ConversationService struct {
	Q        *sqlcdb.Queries
	Pool     *db.ObservablePool
	EventBus pubsub.EventBus
	JSM      *pubsub.JetStreamManager
}

func NewConversationService(q *sqlcdb.Queries, pool *db.ObservablePool, bus pubsub.EventBus, jsm *pubsub.JetStreamManager) *ConversationService {
	return &ConversationService{Q: q, Pool: pool, EventBus: bus, JSM: jsm}
}

func (cs *ConversationService) ListConversations(ctx context.Context, userID string) ([]Conversation, error) {
	rows, err := cs.Q.ListConversations(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []Conversation{}, nil
	}

	convoIDs := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		convoIDs[i] = r.ID
	}

	membersMap, err := cs.fetchConversationMembers(ctx, convoIDs)
	if err != nil {
		return nil, err
	}

	conversations := make([]Conversation, 0, len(rows))
	for _, r := range rows {
		members := membersMap[r.ID]
		if members == nil {
			members = []ConversationMember{}
		}
		conversations = append(conversations, Conversation{
			ID: r.ID, IsGroup: r.IsGroup, Name: r.Name,
			Members: members, LastMessage: r.LastMessage,
			LastMessageTime: r.LastMessageTime.Format(time.RFC3339),
			LastReadSeq:     r.LastReadSeq,
		})
	}
	return conversations, nil
}

func (cs *ConversationService) GetConversation(ctx context.Context, userID string, conversationID uuid.UUID) (*Conversation, error) {
	row, err := cs.Q.GetConversation(ctx, sqlcdb.GetConversationParams{
		UserID:         userID,
		ConversationID: conversationID,
	})
	if err != nil {
		return nil, err
	}

	membersMap, err := cs.fetchConversationMembers(ctx, []uuid.UUID{conversationID})
	if err != nil {
		return nil, err
	}
	members := membersMap[conversationID]
	if members == nil {
		members = []ConversationMember{}
	}
	return &Conversation{
		ID: row.ID, IsGroup: row.IsGroup, Name: row.Name,
		Members: members, LastMessage: row.LastMessage,
		LastMessageTime: row.LastMessageTime.Format(time.RFC3339),
		LastReadSeq:     row.LastReadSeq,
	}, nil
}

func (cs *ConversationService) fetchConversationMembers(ctx context.Context, convoIDs []uuid.UUID) (map[uuid.UUID][]ConversationMember, error) {
	rows, err := cs.Q.FetchConversationMembers(ctx, convoIDs)
	if err != nil {
		return nil, err
	}
	result := make(map[uuid.UUID][]ConversationMember)
	for _, r := range rows {
		name := r.DisplayName
		if name == "" {
			name = r.Username
		}
		result[r.ConversationID] = append(result[r.ConversationID], ConversationMember{
			ID: r.UserID, Username: r.Username, DisplayName: name, AvatarURL: r.AvatarUrl,
		})
	}
	return result, nil
}

func (cs *ConversationService) MarkRead(ctx context.Context, conversationID uuid.UUID, userID string, seq int64) error {
	return cs.Q.MarkReadSeq(ctx, sqlcdb.MarkReadSeqParams{
		LastReadSeq:    pgtype.Int8{Int64: seq, Valid: true},
		ConversationID: conversationID,
		UserID:         userID,
	})
}

func (cs *ConversationService) GetOrCreateDM(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	if otherUserID == "" {
		return uuid.UUID{}, &ValidationError{Msg: "userId is required"}
	}
	if otherUserID == userID {
		return uuid.UUID{}, &ValidationError{Msg: "cannot message yourself"}
	}
	exists, err := cs.Q.ProfileExists(ctx, otherUserID)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("failed to verify user: %w", err)
	}
	if !exists {
		return uuid.UUID{}, &NotFoundError{Msg: "user not found"}
	}
	convoID, err := cs.findOrCreate1to1(ctx, userID, otherUserID)
	if err != nil {
		return uuid.UUID{}, err
	}

	if err := cs.JSM.EnsureConversationStream(convoID.String()); err != nil {
		log.Printf("[dm] failed to ensure JetStream stream for %s: %v", convoID, err)
	}

	return convoID, nil
}

func (cs *ConversationService) findOrCreate1to1(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	id, err := cs.Q.Find1to1Conversation(ctx, sqlcdb.Find1to1ConversationParams{
		UserID:      userID,
		OtherUserID: otherUserID,
	})
	if err == nil {
		return id, nil
	}

	tx, err := cs.Pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := cs.Q.WithTx(tx)

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

type CreateGroupInput struct {
	Name      string
	MemberIDs []string
}

func (cs *ConversationService) CreateGroup(ctx context.Context, userID string, input CreateGroupInput) (*Conversation, error) {
	if len(input.MemberIDs) < 2 {
		return nil, &ValidationError{Msg: "group must have at least 2 other members"}
	}
	if len(input.MemberIDs) > 50 {
		return nil, &ValidationError{Msg: "group cannot exceed 50 members"}
	}
	if input.Name == "" || len(input.Name) > 100 {
		return nil, &ValidationError{Msg: "group name must be 1-100 characters"}
	}

	allMembers := deduplicateMembers(userID, input.MemberIDs)
	if len(allMembers) < 3 {
		return nil, &ValidationError{Msg: "group must have at least 3 members including yourself"}
	}

	count, _ := cs.Q.CountExistingUsers(ctx, allMembers)
	if int(count) != len(allMembers) {
		return nil, &ValidationError{Msg: "one or more users not found"}
	}

	convoID, err := cs.createGroupConversation(ctx, input.Name, userID, allMembers)
	if err != nil {
		return nil, fmt.Errorf("failed to create group: %w", err)
	}

	if err := cs.JSM.EnsureConversationStream(convoID.String()); err != nil {
		log.Printf("[dm] failed to ensure JetStream stream for group %s: %v", convoID, err)
	}

	profileRows, _ := cs.Q.FetchProfilesByIDs(ctx, allMembers)
	profiles := make(map[string]*sqlcdb.FetchProfilesByIDsRow, len(profileRows))
	for i := range profileRows {
		profiles[profileRows[i].ID] = &profileRows[i]
	}
	members := buildMemberList(allMembers, profiles)

	return &Conversation{
		ID:      convoID,
		IsGroup: true,
		Name:    &input.Name,
		Members: members,
	}, nil
}

func (cs *ConversationService) createGroupConversation(ctx context.Context, name, creatorID string, memberIDs []string) (uuid.UUID, error) {
	tx, err := cs.Pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := cs.Q.WithTx(tx)

	convoID, err := qtx.CreateConversation(ctx, sqlcdb.CreateConversationParams{
		IsGroup:   true,
		Name:      &name,
		CreatedBy: &creatorID,
	})
	if err != nil {
		return uuid.UUID{}, err
	}

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

type UpdateInput struct {
	Name          *string
	AddMembers    []string
	RemoveMembers []string
}

func (cs *ConversationService) Update(ctx context.Context, userID string, conversationID uuid.UUID, input UpdateInput) error {
	isGroup, err := cs.Q.IsGroupConversation(ctx, sqlcdb.IsGroupConversationParams{
		UserID:         userID,
		ConversationID: conversationID,
	})
	if err != nil {
		return &NotFoundError{Msg: "conversation not found"}
	}
	if !isGroup {
		return &ValidationError{Msg: "cannot modify a 1:1 conversation"}
	}

	if input.Name != nil {
		name := trimString(*input.Name)
		if name == "" || len(name) > 100 {
			return &ValidationError{Msg: "group name must be 1-100 characters"}
		}
		if err := cs.Q.UpdateConversationName(ctx, sqlcdb.UpdateConversationNameParams{
			Name: &name,
			ID:   conversationID,
		}); err != nil {
			return fmt.Errorf("failed to update name: %w", err)
		}
	}
	if len(input.AddMembers) > 0 {
		if err := cs.Q.AddConversationMembers(ctx, sqlcdb.AddConversationMembersParams{
			ConversationID: conversationID,
			MemberIds:      input.AddMembers,
		}); err != nil {
			return fmt.Errorf("failed to add members: %w", err)
		}
	}
	if len(input.RemoveMembers) > 0 {
		var filtered []string
		for _, id := range input.RemoveMembers {
			if id != userID {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) > 0 {
			if err := cs.Q.RemoveConversationMembers(ctx, sqlcdb.RemoveConversationMembersParams{
				ConversationID: conversationID,
				MemberIds:      filtered,
			}); err != nil {
				return fmt.Errorf("failed to remove members: %w", err)
			}
		}
	}
	return nil
}

func (cs *ConversationService) GetMessages(ctx context.Context, userID string, conversationID uuid.UUID, before, limitStr string) ([]DirectMessage, error) {
	isMember, _ := cs.Q.IsConversationMember(ctx, sqlcdb.IsConversationMemberParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
	if !isMember {
		return nil, &NotFoundError{Msg: "conversation not found"}
	}

	limit := 50
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = int(math.Min(float64(l), 100))
	}

	var beforeSeq uint64
	if before != "" {
		parsed, err := strconv.ParseUint(before, 10, 64)
		if err != nil {
			return nil, &ValidationError{Msg: "invalid before cursor"}
		}
		beforeSeq = parsed
	}

	msgs, err := cs.JSM.GetMessages(ctx, conversationID.String(), limit, beforeSeq)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	result := make([]DirectMessage, len(msgs))
	for i, m := range msgs {
		result[i] = DirectMessage{
			ID:             m.ID,
			ConversationID: conversationID.String(),
			SenderID:       m.SenderID,
			Content:        m.Content,
			CreatedAt:      m.CreatedAt,
			Sequence:       m.Sequence,
		}
	}
	return result, nil
}

func (cs *ConversationService) SendMessage(ctx context.Context, userID string, conversationID uuid.UUID, content string) (*DirectMessage, error) {
	isMember, _ := cs.Q.IsConversationMember(ctx, sqlcdb.IsConversationMemberParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
	if !isMember {
		return nil, &NotFoundError{Msg: "conversation not found"}
	}
	content = trimString(content)
	if content == "" || len(content) > 2000 {
		return nil, &ValidationError{Msg: "message must be 1-2000 characters"}
	}

	now := time.Now()
	msgID := uuid.New().String()

	jsMsg := &pubsub.ConversationMessage{
		ID:        msgID,
		SenderID:  userID,
		Content:   content,
		CreatedAt: now,
	}

	seq, err := cs.JSM.PublishMessage(conversationID.String(), jsMsg)
	if err != nil {
		return nil, fmt.Errorf("failed to publish message: %w", err)
	}

	// Update denormalized last-message columns in Postgres.
	if err := cs.Q.TouchConversationWithMessage(ctx, sqlcdb.TouchConversationWithMessageParams{
		Content:        &content,
		SenderID:       &userID,
		MessageAt:      &now,
		ConversationID: conversationID,
	}); err != nil {
		log.Printf("[dm] failed to touch conversation %s: %v", conversationID, err)
	}

	msg := &DirectMessage{
		ID:             msgID,
		ConversationID: conversationID.String(),
		SenderID:       userID,
		Content:        content,
		CreatedAt:      now,
		Sequence:       seq,
	}

	// Fire SSE events via the fire-and-forget Watermill bus.
	if cs.EventBus != nil {
		memberIDs, _ := cs.Q.GetConversationMemberIDs(ctx, conversationID)
		if pubErr := events.Publish(cs.EventBus, ctx, "dm_changes", events.DmEvent{
			ConversationID: conversationID,
			SenderID:       msg.SenderID,
			MemberIDs:      memberIDs,
			ID:             uuid.MustParse(msg.ID),
			Content:        msg.Content,
			CreatedAt:      msg.CreatedAt.Format(time.RFC3339Nano),
		}); pubErr != nil {
			log.Printf("[dm] EventBus publish error: %v", pubErr)
		}

		if pubErr := events.Publish(cs.EventBus, ctx, "push_dm", events.PushDmEvent{
			ConversationID: conversationID,
			SenderID:       msg.SenderID,
			MemberIDs:      memberIDs,
			Content:        msg.Content,
		}); pubErr != nil {
			log.Printf("[dm] EventBus push publish error: %v", pubErr)
		}
	}

	return msg, nil
}

func (cs *ConversationService) Leave(ctx context.Context, userID string, conversationID uuid.UUID) error {
	isGroup, err := cs.Q.IsGroupConversation(ctx, sqlcdb.IsGroupConversationParams{
		UserID:         userID,
		ConversationID: conversationID,
	})
	if err != nil {
		return &NotFoundError{Msg: "conversation not found"}
	}
	if !isGroup {
		return &ValidationError{Msg: "cannot leave a 1:1 conversation"}
	}
	return cs.Q.LeaveConversation(ctx, sqlcdb.LeaveConversationParams{
		ConversationID: conversationID,
		UserID:         userID,
	})
}

func (cs *ConversationService) ResolveConversationID(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	if otherUserID == "" || otherUserID == userID {
		return uuid.UUID{}, &NotFoundError{Msg: "conversation not found"}
	}
	return cs.findOrCreate1to1(ctx, userID, otherUserID)
}

func deduplicateMembers(creatorID string, memberIDs []string) []string {
	seen := map[string]bool{creatorID: true}
	unique := []string{creatorID}
	for _, id := range memberIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	return unique
}

func buildMemberList(ids []string, profiles map[string]*sqlcdb.FetchProfilesByIDsRow) []ConversationMember {
	members := make([]ConversationMember, 0, len(ids))
	for _, id := range ids {
		m := ConversationMember{ID: id}
		if p := profiles[id]; p != nil {
			m.Username = p.Username
			m.DisplayName = p.DisplayName
			if m.DisplayName == "" {
				m.DisplayName = p.Username
			}
			m.AvatarURL = p.AvatarUrl
		}
		members = append(members, m)
	}
	return members
}
