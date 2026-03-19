package service

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Conversation is the API response shape for conversations.
type Conversation struct {
	ID              uuid.UUID            `json:"id"`
	IsGroup         bool                 `json:"isGroup"`
	Name            *string              `json:"name"`
	Members         []ConversationMember `json:"members"`
	LastMessage     string               `json:"lastMessage"`
	LastMessageTime string               `json:"lastMessageTime"`
	UnreadCount     int                  `json:"unreadCount"`
	LastReadSeq     int64                `json:"lastReadSeq"`
}

// ConversationMember is a participant in a conversation.
type ConversationMember struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

// DirectMessage is the API response shape for DM messages.
type DirectMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
	Sequence       uint64    `json:"sequence"`
}

// CallRecord is the API response shape for call records.
type CallRecord struct {
	ID              uuid.UUID `json:"id"`
	ConversationID  uuid.UUID `json:"conversation_id"`
	CallerID        string    `json:"caller_id"`
	CalleeID        string    `json:"callee_id"`
	Status          string    `json:"status"`
	RoomName        string    `json:"room_name,omitempty"`
	CreatedAt       string    `json:"created_at"`
	StartedAt       *string   `json:"started_at,omitempty"`
	EndedAt         *string   `json:"ended_at,omitempty"`
	DurationSeconds *int      `json:"duration_seconds,omitempty"`
}

// NotificationRow is the API response shape for notifications.
type NotificationRow struct {
	ID          uuid.UUID `json:"id"`
	UserID      string    `json:"user_id"`
	ForumDomain string    `json:"forum_domain"`
	ForumName   string    `json:"forum_name"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	Link        string    `json:"link"`
	Read        bool      `json:"read"`
	CreatedAt   string    `json:"created_at"`
}

func callRowToRecord(
	id, conversationID uuid.UUID,
	callerID, calleeID, status string,
	roomName *string,
	createdAt time.Time,
	startedAt, endedAt *time.Time,
	durationSeconds pgtype.Int4,
) *CallRecord {
	rec := &CallRecord{
		ID:             id,
		ConversationID: conversationID,
		CallerID:       callerID,
		CalleeID:       calleeID,
		Status:         status,
		CreatedAt:      createdAt.Format(time.RFC3339),
	}
	if roomName != nil {
		rec.RoomName = *roomName
	}
	if startedAt != nil {
		t := startedAt.Format(time.RFC3339)
		rec.StartedAt = &t
	}
	if endedAt != nil {
		t := endedAt.Format(time.RFC3339)
		rec.EndedAt = &t
	}
	if durationSeconds.Valid {
		d := int(durationSeconds.Int32)
		rec.DurationSeconds = &d
	}
	return rec
}
