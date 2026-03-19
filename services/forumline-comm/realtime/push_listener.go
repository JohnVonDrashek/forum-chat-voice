package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type PushListener struct {
	Store       *store.Store
	PushService *service.PushService
}

func NewPushListener(s *store.Store, ps *service.PushService) *PushListener {
	return &PushListener{Store: s, PushService: ps}
}

func (pl *PushListener) HandlePayload(ctx context.Context, raw []byte) error {
	var payload struct {
		ConversationID string   `json:"conversation_id"`
		SenderID       string   `json:"sender_id"`
		MemberIDs      []string `json:"member_ids"`
		Content        string   `json:"content"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Errorf("parse payload: %w", err)
	}

	senderUsername := pl.Store.GetSenderUsername(ctx, payload.SenderID)
	title := fmt.Sprintf("Message from %s", senderUsername)
	body := payload.Content
	if len(body) > 100 {
		body = body[:100]
	}

	for _, memberID := range payload.MemberIDs {
		if memberID == payload.SenderID {
			continue
		}
		sent := pl.PushService.SendToUser(ctx, memberID, title, body, "", "")
		if sent > 0 {
			log.Printf("PushListener: sent %d push notifications for DM to %s", sent, memberID)
		}
	}
	return nil
}
