package shared

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SSEClient represents a connected SSE client with a filter.
type SSEClient struct {
	Channel string            // LISTEN channel name
	Filter  map[string]string // e.g. {"recipient_id": "uuid"}
	Send    chan []byte
	Done    chan struct{}
}

// SSEHub manages LISTEN/NOTIFY subscriptions and fans out to SSE clients.
type SSEHub struct {
	mu      sync.RWMutex
	clients map[string][]*SSEClient // channel -> clients
	pool    *pgxpool.Pool
}

func NewSSEHub(pool *pgxpool.Pool) *SSEHub {
	return &SSEHub{
		clients: make(map[string][]*SSEClient),
		pool:    pool,
	}
}

// Listen starts a goroutine that listens on the given Postgres channel
// and fans out notifications to registered clients.
func (h *SSEHub) Listen(ctx context.Context, channel string) {
	go func() {
		conn, err := h.pool.Acquire(ctx)
		if err != nil {
			log.Printf("SSEHub: failed to acquire connection for LISTEN %s: %v", channel, err)
			return
		}
		defer conn.Release()

		_, err = conn.Exec(ctx, fmt.Sprintf("LISTEN %s", channel))
		if err != nil {
			log.Printf("SSEHub: LISTEN %s failed: %v", channel, err)
			return
		}

		log.Printf("SSEHub: listening on channel %s", channel)

		for {
			notification, err := conn.Conn().WaitForNotification(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return // context cancelled, clean shutdown
				}
				log.Printf("SSEHub: WaitForNotification error on %s: %v", channel, err)
				return
			}

			h.broadcast(channel, []byte(notification.Payload))
		}
	}()
}

// broadcast sends a payload to all clients listening on the given channel,
// filtering by each client's filter criteria.
func (h *SSEHub) broadcast(channel string, payload []byte) {
	h.mu.RLock()
	clients := h.clients[channel]
	h.mu.RUnlock()

	// Parse payload for filtering
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		log.Printf("SSEHub: failed to parse payload: %v", err)
		return
	}

	for _, client := range clients {
		if matchesFilter(data, client.Filter) {
			select {
			case client.Send <- payload:
			default:
				// Client buffer full, skip
			}
		}
	}
}

// Register adds an SSE client to the hub.
func (h *SSEHub) Register(client *SSEClient) {
	h.mu.Lock()
	h.clients[client.Channel] = append(h.clients[client.Channel], client)
	h.mu.Unlock()
}

// Unregister removes an SSE client from the hub.
func (h *SSEHub) Unregister(client *SSEClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	clients := h.clients[client.Channel]
	for i, c := range clients {
		if c == client {
			h.clients[client.Channel] = append(clients[:i], clients[i+1:]...)
			break
		}
	}
}

// ServeSSE writes SSE events to the response writer for the given client.
func ServeSSE(w http.ResponseWriter, r *http.Request, client *SSEClient) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-client.Done:
			return
		case data := <-client.Send:
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func matchesFilter(data map[string]interface{}, filter map[string]string) bool {
	for key, expected := range filter {
		val, ok := data[key]
		if !ok {
			return false
		}
		if fmt.Sprintf("%v", val) != expected {
			return false
		}
	}
	return true
}
