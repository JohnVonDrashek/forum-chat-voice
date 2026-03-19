package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

// JetStreamManager provides message persistence via NATS JetStream.
// Used alongside the Watermill EventBus: Watermill handles fire-and-forget
// events (dm_changes, call_signal), JetStream handles durable message storage.
type JetStreamManager struct {
	js nats.JetStreamContext
	nc *nats.Conn
}

// NewJetStreamManager connects to NATS and initializes a JetStream context.
// Pass the same NATS URL used by the Watermill bus — it's a separate connection
// so they don't interfere with each other.
func NewJetStreamManager(natsURL string) (*JetStreamManager, error) {
	nc, err := nats.Connect(natsURL,
		nats.Name("forumline-jetstream"),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("jetstream connect: %w", err)
	}
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("jetstream init: %w", err)
	}
	return &JetStreamManager{js: js, nc: nc}, nil
}

// Close tears down the NATS connection.
func (m *JetStreamManager) Close() {
	m.nc.Close()
}

// EnsureConversationStream creates or updates a stream for a conversation.
// Stream name: CONV_{conversationID} (hyphens replaced with underscores).
// Subject: conv.{conversationID}.>
func (m *JetStreamManager) EnsureConversationStream(conversationID string) error {
	streamName := "CONV_" + sanitizeStreamName(conversationID)
	subject := "conv." + conversationID + ".>"

	_, err := m.js.StreamInfo(streamName)
	if err == nats.ErrStreamNotFound {
		_, err = m.js.AddStream(&nats.StreamConfig{
			Name:      streamName,
			Subjects:  []string{subject},
			Retention: nats.LimitsPolicy,
			MaxMsgs:   10000,                // keep last 10k messages per conversation
			MaxAge:    90 * 24 * time.Hour,   // 90 day retention
			Storage:   nats.FileStorage,
			Discard:   nats.DiscardOld,
		})
		return err
	}
	return err
}

// PublishMessage publishes a message to a conversation stream.
// Subject format: conv.{conversationID}.msg
// Returns the stream sequence number (used as message ID for pagination).
func (m *JetStreamManager) PublishMessage(conversationID string, msg *ConversationMessage) (uint64, error) {
	data, err := json.Marshal(msg)
	if err != nil {
		return 0, err
	}
	subject := "conv." + conversationID + ".msg"
	ack, err := m.js.Publish(subject, data)
	if err != nil {
		return 0, err
	}
	return ack.Sequence, nil
}

// GetMessages retrieves messages from a conversation stream.
// Uses an ephemeral ordered consumer to fetch messages in sequence order.
// If beforeSeq > 0, fetches messages before that sequence number.
// Returns messages in chronological order (oldest first) — the caller
// can reverse if needed.
func (m *JetStreamManager) GetMessages(ctx context.Context, conversationID string, limit int, beforeSeq uint64) ([]ConversationMessage, error) {
	streamName := "CONV_" + sanitizeStreamName(conversationID)

	info, err := m.js.StreamInfo(streamName)
	if err != nil {
		if err == nats.ErrStreamNotFound {
			return nil, nil
		}
		return nil, err
	}

	if info.State.Msgs == 0 {
		return nil, nil
	}

	endSeq := info.State.LastSeq
	if beforeSeq > 0 && beforeSeq <= endSeq {
		endSeq = beforeSeq - 1
	}

	if endSeq < info.State.FirstSeq {
		return nil, nil
	}

	var startSeq uint64
	if endSeq-uint64(limit)+1 > info.State.FirstSeq && uint64(limit) <= endSeq {
		startSeq = endSeq - uint64(limit) + 1
	} else {
		startSeq = info.State.FirstSeq
	}

	sub, err := m.js.SubscribeSync(
		"conv."+conversationID+".msg",
		nats.OrderedConsumer(),
		nats.StartSequence(startSeq),
	)
	if err != nil {
		return nil, fmt.Errorf("subscribe: %w", err)
	}
	defer func() { _ = sub.Unsubscribe() }()

	var messages []ConversationMessage
	for seq := startSeq; seq <= endSeq; seq++ {
		msg, err := sub.NextMsgWithContext(ctx)
		if err != nil {
			break
		}
		var cm ConversationMessage
		if err := json.Unmarshal(msg.Data, &cm); err != nil {
			continue
		}
		meta, _ := msg.Metadata()
		if meta != nil {
			cm.Sequence = meta.Sequence.Stream
		}
		messages = append(messages, cm)
	}

	return messages, nil
}

// GetUnreadCount returns the number of messages after a given sequence.
func (m *JetStreamManager) GetUnreadCount(conversationID string, lastReadSeq uint64) (int, error) {
	streamName := "CONV_" + sanitizeStreamName(conversationID)
	info, err := m.js.StreamInfo(streamName)
	if err != nil {
		if err == nats.ErrStreamNotFound {
			return 0, nil
		}
		return 0, err
	}
	if info.State.Msgs == 0 || lastReadSeq >= info.State.LastSeq {
		return 0, nil
	}
	return int(info.State.LastSeq - lastReadSeq), nil
}

// DeleteConversationStream deletes the stream for a conversation.
func (m *JetStreamManager) DeleteConversationStream(conversationID string) error {
	streamName := "CONV_" + sanitizeStreamName(conversationID)
	return m.js.DeleteStream(streamName)
}

// ConversationMessage is the message format stored in JetStream.
type ConversationMessage struct {
	ID        string    `json:"id"`
	SenderID  string    `json:"sender_id"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	Sequence  uint64    `json:"sequence,omitempty"` // populated on read from stream metadata
}

func sanitizeStreamName(id string) string {
	result := make([]byte, len(id))
	for i := range id {
		if id[i] == '-' {
			result[i] = '_'
		} else {
			result[i] = id[i]
		}
	}
	return string(result)
}
