package handler

import (
	"fmt"
	"net/http"

	shared "github.com/forumline/forumline/shared-go"
)

type EventsHandler struct {
	SSEHub *shared.SSEHub
}

func NewEventsHandler(hub *shared.SSEHub) *EventsHandler {
	return &EventsHandler{SSEHub: hub}
}

// HandleStream serves GET /api/events/stream — a single multiplexed SSE
// connection carrying DM, notification, and call events tagged by type.
func (h *EventsHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	mc := &shared.SSEMultiClient{
		Entries: []shared.SSEMultiEntry{
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
		Send: make(chan shared.SSETaggedEvent, 32),
		Done: make(chan struct{}),
	}

	clients := h.SSEHub.RegisterMulti(mc)
	defer func() {
		h.SSEHub.UnregisterMulti(clients)
		close(mc.Done)
	}()

	shared.ServeSSEMulti(w, r, mc)
}
