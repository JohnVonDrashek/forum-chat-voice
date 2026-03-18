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

// PostService handles post business logic.
type PostService struct {
	Store           *store.Store
	NotificationSvc *NotificationService
	EventBus        pubsub.EventBus
	Schema          string
}

// NewPostService creates a new PostService.
func NewPostService(s *store.Store, notifSvc *NotificationService, bus pubsub.EventBus, schema string) *PostService {
	return &PostService{Store: s, NotificationSvc: notifSvc, EventBus: bus, Schema: schema}
}

// ListByThread returns posts for a thread.
func (ps *PostService) ListByThread(ctx context.Context, threadID uuid.UUID) ([]oapi.Post, error) {
	return ps.Store.ListPostsByThread(ctx, threadID)
}

// ListByUser returns posts authored by a user.
func (ps *PostService) ListByUser(ctx context.Context, userID uuid.UUID) ([]oapi.Post, error) {
	return ps.Store.ListUserPosts(ctx, userID)
}

// Search searches posts by content.
func (ps *PostService) Search(ctx context.Context, query string) ([]oapi.Post, error) {
	if query == "" {
		return []oapi.Post{}, nil
	}
	return ps.Store.SearchPosts(ctx, "%"+query+"%")
}

// CreatePostInput holds input for creating a post.
type CreatePostInput struct {
	ThreadID  uuid.UUID
	Content   string
	ReplyToID *uuid.UUID
}

// Create creates a new post, updates thread stats, and triggers notifications.
func (ps *PostService) Create(ctx context.Context, userID uuid.UUID, input CreatePostInput) (uuid.UUID, error) {
	if input.ThreadID == (uuid.UUID{}) || input.Content == "" {
		return uuid.UUID{}, &ValidationError{Msg: "thread_id and content are required"}
	}

	id, err := ps.Store.CreatePost(ctx, input.ThreadID, userID, input.Content, input.ReplyToID)
	if err != nil {
		return uuid.UUID{}, err
	}

	// Update thread stats (best-effort)
	if err := ps.Store.UpdateThreadStats(ctx, input.ThreadID, time.Now()); err != nil {
		log.Printf("update thread stats error: %v", err)
	}

	// Publish post_changes event
	if ps.EventBus != nil {
		payload, _ := json.Marshal(map[string]interface{}{
			"schema":      ps.Schema,
			"id":          id,
			"thread_id":   input.ThreadID,
			"author_id":   userID,
			"content":     input.Content,
			"reply_to_id": input.ReplyToID,
			"created_at":  time.Now(),
		})
		if err := ps.EventBus.Publish(context.Background(), "post_changes", payload); err != nil {
			log.Printf("[post] EventBus publish error: %v", err)
		}
	}

	// Generate notifications in background
	go ps.NotificationSvc.GeneratePostNotifications(input.ThreadID, id, userID, input.Content, input.ReplyToID) //nolint:gosec

	return id, nil
}
