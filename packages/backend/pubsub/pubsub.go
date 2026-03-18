// Package pubsub provides a transport-agnostic event bus for realtime events.
//
// The EventBus interface decouples event producers (database triggers, service
// layer code) from consumers (SSE hub, push notification listeners). This
// allows swapping Postgres LISTEN/NOTIFY for NATS (or anything else) without
// changing handler or service code.
package pubsub

import "context"

// EventBus is the core publish/subscribe interface for realtime events.
type EventBus interface {
	// Publish sends data on the given subject. Subject names match the
	// Postgres LISTEN/NOTIFY channel names (e.g. "dm_changes").
	Publish(ctx context.Context, subject string, data []byte) error

	// Subscribe registers a handler for messages on the given subject.
	// The handler is called synchronously per message — launch a goroutine
	// inside the handler if processing is expensive.
	Subscribe(subject string, handler func(data []byte)) error

	// Close tears down the connection. Safe to call multiple times.
	Close()
}
