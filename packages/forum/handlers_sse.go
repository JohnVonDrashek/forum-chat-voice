package forum

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/forum/oapi"
)

// ── StreamChatMessages ────────────────────────────────────────────────

// chatSSEStream implements oapi.StreamChatMessagesResponseObject.
// Its Visit method blocks and runs the SSE loop.
type chatSSEStream struct {
	ctx       context.Context
	h         *Handlers
	channelID string
}

func (s chatSSEStream) VisitStreamChatMessagesResponse(w http.ResponseWriter) error {
	client := &sse.Client{
		Channel: "chat_message_changes",
		Filter:  map[string]string{"channel_id": s.channelID},
		Send:    make(chan []byte, 32),
		Done:    make(chan struct{}),
	}

	s.h.SSEHub.Register(client)
	defer func() {
		s.h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	rc := http.NewResponseController(w)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if _, err := fmt.Fprint(w, ":connected\n\n"); err != nil {
		return nil
	}
	if err := rc.Flush(); err != nil {
		return nil
	}

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return nil
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ":heartbeat\n\n"); err != nil {
				return nil
			}
			_ = rc.Flush()
		case data := <-client.Send:
			var raw map[string]interface{}
			if err := json.Unmarshal(data, &raw); err != nil {
				continue
			}
			authorID, _ := raw["author_id"].(string)
			if authorID != "" {
				if p, err := s.h.ProfileCache.Get(s.ctx, s.h.Config.Domain, authorID); err == nil {
					raw["author"] = p
				}
			}
			enriched, _ := json.Marshal(raw)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", enriched); err != nil {
				return nil
			}
			_ = rc.Flush()
		}
	}
}

// StreamChatMessages handles GET /api/channels/{slug}/stream (SSE).
func (h *Handlers) StreamChatMessages(ctx context.Context, request oapi.StreamChatMessagesRequestObject) (oapi.StreamChatMessagesResponseObject, error) {
	channelID, err := h.Store.GetChannelIDBySlug(ctx, request.Slug)
	if err != nil {
		return oapi.StreamChatMessages404JSONResponse{NotFoundJSONResponse: oapi.NotFoundJSONResponse{Error: "channel not found"}}, nil
	}
	return chatSSEStream{ctx: ctx, h: h, channelID: channelID.String()}, nil
}

// ── StreamPosts ───────────────────────────────────────────────────────

// postsSSEStream implements oapi.StreamPostsResponseObject.
type postsSSEStream struct {
	ctx      context.Context
	h        *Handlers
	threadID string
}

func (s postsSSEStream) VisitStreamPostsResponse(w http.ResponseWriter) error {
	client := &sse.Client{
		Channel: "post_changes",
		Filter:  map[string]string{"thread_id": s.threadID},
		Send:    make(chan []byte, 32),
		Done:    make(chan struct{}),
	}

	s.h.SSEHub.Register(client)
	defer func() {
		s.h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	rc := http.NewResponseController(w)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if _, err := fmt.Fprint(w, ":connected\n\n"); err != nil {
		return nil
	}
	if err := rc.Flush(); err != nil {
		return nil
	}

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return nil
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ":heartbeat\n\n"); err != nil {
				return nil
			}
			_ = rc.Flush()
		case data := <-client.Send:
			var raw map[string]interface{}
			if err := json.Unmarshal(data, &raw); err != nil {
				continue
			}
			authorID, _ := raw["author_id"].(string)
			if authorID != "" {
				if p, err := s.h.ProfileCache.Get(s.ctx, s.h.Config.Domain, authorID); err == nil {
					raw["author"] = p
				}
			}
			enriched, _ := json.Marshal(raw)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", enriched); err != nil {
				return nil
			}
			_ = rc.Flush()
		}
	}
}

// StreamPosts handles GET /api/threads/{id}/stream (SSE).
func (h *Handlers) StreamPosts(ctx context.Context, request oapi.StreamPostsRequestObject) (oapi.StreamPostsResponseObject, error) {
	return postsSSEStream{ctx: ctx, h: h, threadID: request.Id.String()}, nil
}

// ── StreamVoicePresence ───────────────────────────────────────────────

// voicePresenceSSEStream implements oapi.StreamVoicePresenceResponseObject.
type voicePresenceSSEStream struct {
	ctx context.Context
	h   *Handlers
}

func (s voicePresenceSSEStream) VisitStreamVoicePresenceResponse(w http.ResponseWriter) error {
	client := &sse.Client{
		Channel: "voice_presence_changes",
		Filter:  map[string]string{},
		Send:    make(chan []byte, 32),
		Done:    make(chan struct{}),
	}

	s.h.SSEHub.Register(client)
	defer func() {
		s.h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	rc := http.NewResponseController(w)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if _, err := fmt.Fprint(w, ":connected\n\n"); err != nil {
		return nil
	}
	if err := rc.Flush(); err != nil {
		return nil
	}

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return nil
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ":heartbeat\n\n"); err != nil {
				return nil
			}
			_ = rc.Flush()
		case data := <-client.Send:
			var raw map[string]interface{}
			if err := json.Unmarshal(data, &raw); err != nil {
				continue
			}
			userID, _ := raw["user_id"].(string)
			if userID != "" {
				if p, err := s.h.ProfileCache.Get(s.ctx, s.h.Config.Domain, userID); err == nil {
					raw["profile"] = p
				}
			}
			enriched, _ := json.Marshal(raw)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", enriched); err != nil {
				return nil
			}
			_ = rc.Flush()
		}
	}
}

// StreamVoicePresence handles GET /api/voice-presence/stream (SSE).
func (h *Handlers) StreamVoicePresence(ctx context.Context, _ oapi.StreamVoicePresenceRequestObject) (oapi.StreamVoicePresenceResponseObject, error) {
	return voicePresenceSSEStream{ctx: ctx, h: h}, nil
}
