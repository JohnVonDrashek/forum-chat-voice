package handler

import (
	"fmt"
	"net/http"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/sse"
)

type EventsHandler struct {
	SSEHub *sse.Hub
}

func NewEventsHandler(hub *sse.Hub) *EventsHandler {
	return &EventsHandler{SSEHub: hub}
}

func (h *EventsHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	mc := &sse.MultiClient{
		Entries: []sse.MultiEntry{
			{
				Channel:   "dm_changes",
				EventType: "dm",
				FilterFunc: func(data map[string]interface{}) bool {
					memberIDs, ok := data["member_ids"]
					if !ok {
						return false
					}
					arr, ok := memberIDs.([]interface{})
					if !ok {
						return false
					}
					for _, id := range arr {
						if fmt.Sprintf("%v", id) == userID {
							return true
						}
					}
					return false
				},
			},
			{
				Channel:   "forumline_notification_changes",
				EventType: "notification",
				FilterFunc: func(data map[string]interface{}) bool {
					return fmt.Sprintf("%v", data["user_id"]) == userID
				},
			},
			{
				Channel:   "call_signal",
				EventType: "call",
				FilterFunc: func(data map[string]interface{}) bool {
					targetID, _ := data["target_user_id"].(string)
					return targetID == userID
				},
			},
		},
		Send: make(chan sse.TaggedEvent, 32),
		Done: make(chan struct{}),
	}

	clients := h.SSEHub.RegisterMulti(mc)
	defer func() {
		h.SSEHub.UnregisterMulti(clients)
		close(mc.Done)
	}()

	sse.ServeMulti(w, r, mc)
}
