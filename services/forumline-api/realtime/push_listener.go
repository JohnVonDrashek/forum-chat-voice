package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
)

// PushListener listens for LISTEN/NOTIFY on the push_dm channel
// and sends web push notifications for new DMs.
type PushListener struct {
	Pool        *pgxpool.Pool
	Store       *store.Store
	PushService *service.PushService
}

func NewPushListener(pool *pgxpool.Pool, s *store.Store, ps *service.PushService) *PushListener {
	return &PushListener{Pool: pool, Store: s, PushService: ps}
}

func (pl *PushListener) Start(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		pl.listenOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		log.Println("PushListener: reconnecting in 3s...")
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (pl *PushListener) listenOnce(ctx context.Context) {
	conn, err := pl.Pool.Acquire(ctx)
	if err != nil {
		log.Printf("PushListener: failed to acquire connection: %v", err)
		return
	}
	defer conn.Release()

	_, err = conn.Exec(ctx, "LISTEN push_dm")
	if err != nil {
		log.Printf("PushListener: LISTEN push_dm failed: %v", err)
		return
	}

	log.Println("PushListener: listening on push_dm channel")

	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("PushListener: WaitForNotification error: %v", err)
			return
		}

		var payload struct {
			ConversationID string   `json:"conversation_id"`
			SenderID       string   `json:"sender_id"`
			MemberIDs      []string `json:"member_ids"`
			Content        string   `json:"content"`
		}
		if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
			log.Printf("PushListener: failed to parse payload: %v", err)
			continue
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
	}
}
