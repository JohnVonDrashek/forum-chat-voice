package service

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/forum/oapi"
	"github.com/forumline/forumline/forum/store"
)

// ChatService handles chat business logic.
type ChatService struct {
	Store    *store.Store
	EventBus pubsub.EventBus
	Schema   string
}

// NewChatService creates a new ChatService.
func NewChatService(s *store.Store, bus pubsub.EventBus, schema string) *ChatService {
	return &ChatService{Store: s, EventBus: bus, Schema: schema}
}

// ListMessages returns chat messages for a channel slug.
func (cs *ChatService) ListMessages(ctx context.Context, slug string) ([]oapi.ChatMessage, error) {
	return cs.Store.ListChatMessages(ctx, slug)
}

// SendMessage sends a chat message to a channel by slug.
func (cs *ChatService) SendMessage(ctx context.Context, userID uuid.UUID, slug, content string) error {
	if content == "" {
		return &ValidationError{Msg: "content is required"}
	}

	channelID, err := cs.Store.GetChannelIDBySlug(ctx, slug)
	if err != nil {
		return &NotFoundError{Msg: "channel not found"}
	}

	id, createdAt, err := cs.Store.InsertChatMessage(ctx, channelID, userID, content)
	if err != nil {
		return err
	}

	cs.publishChatMessage(channelID, id, userID, content, createdAt)
	return nil
}

// SendMessageByID sends a chat message to a channel by ID.
func (cs *ChatService) SendMessageByID(ctx context.Context, userID, channelID uuid.UUID, content string) error {
	if content == "" {
		return &ValidationError{Msg: "content is required"}
	}
	id, createdAt, err := cs.Store.InsertChatMessage(ctx, channelID, userID, content)
	if err != nil {
		return err
	}
	cs.publishChatMessage(channelID, id, userID, content, createdAt)
	return nil
}

func (cs *ChatService) publishChatMessage(channelID, id, authorID uuid.UUID, content string, createdAt time.Time) {
	if cs.EventBus == nil {
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"schema":     cs.Schema,
		"id":         id,
		"channel_id": channelID,
		"author_id":  authorID,
		"content":    content,
		"created_at": createdAt,
	})
	if err := cs.EventBus.Publish(context.Background(), "chat_message_changes", payload); err != nil {
		log.Printf("[chat] EventBus publish error: %v", err)
	}
}
