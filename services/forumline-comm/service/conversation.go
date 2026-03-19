package service

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type ConversationService struct {
	Store    *store.Store
	EventBus pubsub.EventBus
}

func NewConversationService(s *store.Store, bus pubsub.EventBus) *ConversationService {
	return &ConversationService{Store: s, EventBus: bus}
}

func (cs *ConversationService) GetOrCreateDM(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	if otherUserID == "" {
		return uuid.UUID{}, &ValidationError{Msg: "userId is required"}
	}
	if otherUserID == userID {
		return uuid.UUID{}, &ValidationError{Msg: "cannot message yourself"}
	}
	exists, err := cs.Store.ProfileExists(ctx, otherUserID)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("failed to verify user: %w", err)
	}
	if !exists {
		return uuid.UUID{}, &NotFoundError{Msg: "user not found"}
	}
	return cs.Store.FindOrCreate1to1Conversation(ctx, userID, otherUserID)
}

type CreateGroupInput struct {
	Name      string
	MemberIDs []string
}

func (cs *ConversationService) CreateGroup(ctx context.Context, userID string, input CreateGroupInput) (*store.Conversation, error) {
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

	count, _ := cs.Store.CountExistingUsers(ctx, allMembers)
	if count != len(allMembers) {
		return nil, &ValidationError{Msg: "one or more users not found"}
	}

	convoID, err := cs.Store.CreateGroupConversation(ctx, input.Name, userID, allMembers)
	if err != nil {
		return nil, fmt.Errorf("failed to create group: %w", err)
	}

	profiles, _ := cs.Store.FetchProfilesByIDs(ctx, allMembers)
	members := buildMemberList(allMembers, profiles)

	return &store.Conversation{
		ID:      convoID,
		IsGroup: true,
		Name:    &input.Name,
		Members: members,
	}, nil
}

type UpdateInput struct {
	Name          *string
	AddMembers    []string
	RemoveMembers []string
}

func (cs *ConversationService) Update(ctx context.Context, userID string, conversationID uuid.UUID, input UpdateInput) error {
	isGroup, err := cs.Store.IsGroupConversation(ctx, conversationID, userID)
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
		if err := cs.Store.UpdateConversationName(ctx, conversationID, name); err != nil {
			return fmt.Errorf("failed to update name: %w", err)
		}
	}
	if len(input.AddMembers) > 0 {
		if err := cs.Store.AddConversationMembers(ctx, conversationID, input.AddMembers); err != nil {
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
			if err := cs.Store.RemoveConversationMembers(ctx, conversationID, filtered); err != nil {
				return fmt.Errorf("failed to remove members: %w", err)
			}
		}
	}
	return nil
}

func (cs *ConversationService) GetMessages(ctx context.Context, userID string, conversationID uuid.UUID, before, limit string) ([]store.DirectMessage, error) {
	isMember, _ := cs.Store.IsConversationMember(ctx, conversationID, userID)
	if !isMember {
		return nil, &NotFoundError{Msg: "conversation not found"}
	}
	return cs.Store.GetMessages(ctx, conversationID, before, limit)
}

func (cs *ConversationService) SendMessage(ctx context.Context, userID string, conversationID uuid.UUID, content string) (*store.DirectMessage, error) {
	isMember, _ := cs.Store.IsConversationMember(ctx, conversationID, userID)
	if !isMember {
		return nil, &NotFoundError{Msg: "conversation not found"}
	}
	content = trimString(content)
	if content == "" || len(content) > 2000 {
		return nil, &ValidationError{Msg: "message must be 1-2000 characters"}
	}
	msg, err := cs.Store.SendMessage(ctx, conversationID, userID, content)
	if err != nil {
		return nil, err
	}

	if cs.EventBus != nil {
		memberIDs, _ := cs.Store.GetConversationMemberIDs(ctx, conversationID)
		if pubErr := events.Publish(cs.EventBus, ctx, "dm_changes", events.DmEvent{
			ConversationID: msg.ConversationID,
			SenderID:       msg.SenderID,
			MemberIDs:      memberIDs,
			ID:             msg.ID,
			Content:        msg.Content,
			CreatedAt:      msg.CreatedAt.Format(time.RFC3339Nano),
		}); pubErr != nil {
			log.Printf("[dm] EventBus publish error: %v", pubErr)
		}

		if pubErr := events.Publish(cs.EventBus, ctx, "push_dm", events.PushDmEvent{
			ConversationID: msg.ConversationID,
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
	isGroup, err := cs.Store.IsGroupConversation(ctx, conversationID, userID)
	if err != nil {
		return &NotFoundError{Msg: "conversation not found"}
	}
	if !isGroup {
		return &ValidationError{Msg: "cannot leave a 1:1 conversation"}
	}
	return cs.Store.LeaveConversation(ctx, conversationID, userID)
}

func (cs *ConversationService) ResolveConversationID(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	if otherUserID == "" || otherUserID == userID {
		return uuid.UUID{}, &NotFoundError{Msg: "conversation not found"}
	}
	return cs.Store.FindOrCreate1to1Conversation(ctx, userID, otherUserID)
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

func buildMemberList(ids []string, profiles map[string]*store.Profile) []store.ConversationMember {
	members := make([]store.ConversationMember, 0, len(ids))
	for _, id := range ids {
		m := store.ConversationMember{ID: id}
		if p := profiles[id]; p != nil {
			m.Username = p.Username
			m.DisplayName = p.DisplayName
			if m.DisplayName == "" {
				m.DisplayName = p.Username
			}
			m.AvatarURL = p.AvatarURL
		}
		members = append(members, m)
	}
	return members
}
