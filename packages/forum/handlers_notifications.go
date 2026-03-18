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

// ListForumlineNotifications handles GET /api/forumline/notifications.
func (h *Handlers) ListForumlineNotifications(ctx context.Context, _ oapi.ListForumlineNotificationsRequestObject) (oapi.ListForumlineNotificationsResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	notifications, err := h.Store.ListForumlineNotifications(ctx, userID, 50, h.Config.Domain)
	if err != nil {
		return oapi.ListForumlineNotifications500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	return oapi.ListForumlineNotifications200JSONResponse(notifications), nil
}

// MarkNotificationRead handles POST /api/forumline/notifications/read.
func (h *Handlers) MarkNotificationRead(ctx context.Context, request oapi.MarkNotificationReadRequestObject) (oapi.MarkNotificationReadResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	if err := h.Store.MarkNotificationRead(ctx, request.Body.Id, userID); err != nil {
		return oapi.MarkNotificationRead500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	t := true
	return oapi.MarkNotificationRead200JSONResponse(oapi.Success{Success: &t}), nil
}

// GetUnreadCounts handles GET /api/forumline/unread.
func (h *Handlers) GetUnreadCounts(ctx context.Context, _ oapi.GetUnreadCountsRequestObject) (oapi.GetUnreadCountsResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)

	notifCount, chatMentionCount, err := h.Store.CountUnread(ctx, userID)
	if err != nil {
		return oapi.GetUnreadCounts500JSONResponse{InternalErrorJSONResponse: oapi.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	return oapi.GetUnreadCounts200JSONResponse(oapi.UnreadCounts{
		Notifications: notifCount,
		ChatMentions:  chatMentionCount,
		Dms:           0,
	}), nil
}

// notificationSSEStream implements oapi.StreamNotificationsResponseObject.
// Its VisitStreamNotificationsResponse method blocks and runs the SSE loop.
type notificationSSEStream struct {
	ctx    context.Context
	h      *Handlers
	userID string
}

func (s notificationSSEStream) VisitStreamNotificationsResponse(w http.ResponseWriter) error {
	client := &sse.Client{
		Channel: "notification_changes",
		Filter:  map[string]string{"user_id": s.userID},
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
			if err := json.Unmarshal(data, &raw); err == nil {
				event := map[string]interface{}{
					"id":           raw["id"],
					"type":         raw["type"],
					"title":        raw["title"],
					"body":         raw["message"],
					"timestamp":    raw["created_at"],
					"read":         raw["read"],
					"link":         raw["link"],
					"forum_domain": s.h.Config.Domain,
				}
				if event["link"] == nil {
					event["link"] = "/"
				}
				eventJSON, _ := json.Marshal(event)
				if _, err := fmt.Fprintf(w, "data: %s\n\n", eventJSON); err != nil {
					return nil
				}
			} else {
				if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
					return nil
				}
			}
			_ = rc.Flush()
		}
	}
}

// StreamNotifications handles GET /api/forumline/notifications/stream (SSE).
func (h *Handlers) StreamNotifications(ctx context.Context, _ oapi.StreamNotificationsRequestObject) (oapi.StreamNotificationsResponseObject, error) {
	userID := ProfileUUIDFromContext(ctx)
	return notificationSSEStream{ctx: ctx, h: h, userID: userID.String()}, nil
}
