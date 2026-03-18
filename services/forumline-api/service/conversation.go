package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type ConversationService struct {
	Store    *store.Store
	EventBus pubsub.EventBus
}

func NewConversationService(s *store.Store, bus pubsub.EventBus) *ConversationService {
	return &ConversationService{Store: s, EventBus: bus}
}

// GetOrCreateDM finds an existing 1:1 conversation or creates one.
// Returns the conversation ID.
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

// CreateGroupInput is the validated input for creating a group conversation.
type CreateGroupInput struct {
	Name      string
	MemberIDs []string // excluding the creator
}

// CreateGroup creates a group conversation. Returns the full conversation.
func (cs *ConversationService) CreateGroup(ctx context.Context, userID string, input CreateGroupInput) (*oapi.Conversation, error) {
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

	return &oapi.Conversation{
		Id:      convoID,
		IsGroup: true,
		Name:    &input.Name,
		Members: members,
	}, nil
}


// UpdateInput represents optional updates to a group conversation.
type UpdateInput struct {
	Name          *string
	AddMembers    []string
	RemoveMembers []string
}

// Update modifies a group conversation (rename, add/remove members).
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

// GetMessages returns paginated messages for a conversation.
// Enforces membership before returning messages.
func (cs *ConversationService) GetMessages(ctx context.Context, userID string, conversationID uuid.UUID, before, limit string) ([]oapi.DirectMessage, error) {
	isMember, _ := cs.Store.IsConversationMember(ctx, conversationID, userID)
	if !isMember {
		return nil, &NotFoundError{Msg: "conversation not found"}
	}
	return cs.Store.GetMessages(ctx, conversationID, before, limit)
}

// SendMessage sends a message to a conversation. Enforces membership.
func (cs *ConversationService) SendMessage(ctx context.Context, userID string, conversationID uuid.UUID, content string) (*oapi.DirectMessage, error) {
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

	// Publish dm_changes and push_dm events
	if cs.EventBus != nil {
		memberIDs, _ := cs.Store.GetConversationMemberIDs(ctx, conversationID)
		dmPayload, _ := json.Marshal(map[string]interface{}{
			"conversation_id": msg.ConversationId,
			"sender_id":       msg.SenderId,
			"member_ids":      memberIDs,
			"id":              msg.Id,
			"content":         msg.Content,
			"created_at":      msg.CreatedAt,
		})
		if pubErr := cs.EventBus.Publish(ctx, "dm_changes", dmPayload); pubErr != nil {
			log.Printf("[dm] EventBus publish error: %v", pubErr)
		}

		pushPayload, _ := json.Marshal(map[string]interface{}{
			"conversation_id": msg.ConversationId,
			"sender_id":       msg.SenderId,
			"member_ids":      memberIDs,
			"content":         msg.Content,
		})
		if pubErr := cs.EventBus.Publish(ctx, "push_dm", pushPayload); pubErr != nil {
			log.Printf("[dm] EventBus push publish error: %v", pubErr)
		}
	}

	return msg, nil
}

// Leave removes the user from a group conversation.
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

// ResolveConversationID finds or creates a 1:1 conversation for legacy DM routes.
func (cs *ConversationService) ResolveConversationID(ctx context.Context, userID, otherUserID string) (uuid.UUID, error) {
	if otherUserID == "" || otherUserID == userID {
		return uuid.UUID{}, &NotFoundError{Msg: "conversation not found"}
	}
	return cs.Store.FindOrCreate1to1Conversation(ctx, userID, otherUserID)
}

// --- helpers ---

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

func buildMemberList(ids []string, profiles map[string]*store.Profile) []oapi.ConversationMember {
	members := make([]oapi.ConversationMember, 0, len(ids))
	for _, id := range ids {
		m := oapi.ConversationMember{Id: id}
		if p := profiles[id]; p != nil {
			m.Username = p.Username
			m.DisplayName = p.DisplayName
			if m.DisplayName == "" {
				m.DisplayName = p.Username
			}
			m.AvatarUrl = p.AvatarURL
		}
		members = append(members, m)
	}
	return members
}

