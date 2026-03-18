package pubsub

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// NATSBus implements EventBus backed by a NATS server.
type NATSBus struct {
	conn *nats.Conn
}

// NewNATSBus connects to NATS at the given URL and returns an EventBus.
// The connection auto-reconnects on failure with exponential backoff.
func NewNATSBus(url string) (*NATSBus, error) {
	conn, err := nats.Connect(url,
		nats.Name("forumline"),
		nats.MaxReconnects(-1), // reconnect forever
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				log.Printf("NATS disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			log.Println("NATS reconnected")
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	log.Printf("NATS connected to %s", url)
	return &NATSBus{conn: conn}, nil
}

func (n *NATSBus) Publish(_ context.Context, subject string, data []byte) error {
	return n.conn.Publish(subject, data)
}

func (n *NATSBus) Subscribe(subject string, handler func(data []byte)) error {
	_, err := n.conn.Subscribe(subject, func(msg *nats.Msg) {
		handler(msg.Data)
	})
	return err
}

func (n *NATSBus) Close() {
	if n.conn != nil {
		_ = n.conn.Drain()
	}
}
