package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Client represents a connected SSE client with a filter.
type Client struct {
	Channel    string                                 // LISTEN channel name
	Filter     map[string]string                      // e.g. {"recipient_id": "uuid"}
	FilterFunc func(data map[string]interface{}) bool // dynamic filter (used instead of Filter when set)
	Send       chan []byte
	Done       chan struct{}
}

// Hub manages SSE client subscriptions and fans out events to connected
// browsers. Events can arrive from any source via Feed() — NATS in
// production, or direct PG LISTEN for local development.
type Hub struct {
	mu       sync.RWMutex
	clients  map[string][]*Client // channel -> clients
	channels []string             // channels for PG LISTEN fallback
}

// NewHub creates an empty Hub. Call Feed() to push events in, or use
// Listen()+StartListening() for the legacy PG LISTEN fallback path.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string][]*Client),
	}
}

// Listen registers a channel for the PG LISTEN fallback path.
// Call StartListening after all channels are registered.
func (h *Hub) Listen(_ context.Context, channel string) {
	h.channels = append(h.channels, channel)
}

// StartListening opens a single Postgres connection and LISTENs on all
// registered channels, feeding events into the hub via broadcast().
// This is the fallback path for local development without NATS.
func (h *Hub) StartListening(ctx context.Context, listenDSN string) {
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			h.listenAll(ctx, listenDSN)
			if ctx.Err() != nil {
				return
			}
			log.Printf("SSEHub: reconnecting all channels in 3s...")
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}()
}

func (h *Hub) listenAll(ctx context.Context, dsn string) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Printf("SSEHub: failed to connect for LISTEN: %v", err)
		return
	}
	defer func() { _ = conn.Close(ctx) }()

	for _, channel := range h.channels {
		quoted := pgx.Identifier{channel}.Sanitize()
		_, err = conn.Exec(ctx, fmt.Sprintf("LISTEN %s", quoted))
		if err != nil {
			log.Printf("SSEHub: LISTEN %s failed: %v", channel, err)
			return
		}
	}

	log.Printf("SSEHub: listening on %d channels via single connection", len(h.channels))

	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("SSEHub: WaitForNotification error: %v", err)
			return
		}

		h.broadcast(notification.Channel, []byte(notification.Payload))
	}
}

// broadcast sends a payload to all clients listening on the given channel,
// filtering by each client's filter criteria.
func (h *Hub) broadcast(channel string, payload []byte) {
	h.mu.RLock()
	clients := h.clients[channel]
	h.mu.RUnlock()

	if len(clients) == 0 {
		return
	}

	// Parse payload for filtering
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		log.Printf("SSEHub: failed to parse payload: %v", err)
		return
	}

	for _, client := range clients {
		matched := false
		if client.FilterFunc != nil {
			matched = client.FilterFunc(data)
		} else {
			matched = matchesFilter(data, client.Filter)
		}
		if matched {
			select {
			case client.Send <- payload:
			default:
				// Client buffer full, skip
			}
		}
	}
}

// Register adds an SSE client to the hub.
func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	h.clients[client.Channel] = append(h.clients[client.Channel], client)
	h.mu.Unlock()
}

// Unregister removes an SSE client from the hub.
func (h *Hub) Unregister(client *Client) {
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

// Serve writes SSE events to the response writer for the given client.
func Serve(w http.ResponseWriter, r *http.Request, client *Client) {
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
			if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// MultiClient fans multiple channel subscriptions into a single HTTP response.
// Each event is tagged with the SSE "event:" field so clients can use addEventListener.
type MultiClient struct {
	Entries []MultiEntry
	Send    chan TaggedEvent
	Done    chan struct{}
}

// MultiEntry describes one channel subscription within a multi-client.
type MultiEntry struct {
	Channel    string
	EventType  string // SSE event: field (e.g. "dm", "notification", "call")
	FilterFunc func(data map[string]interface{}) bool
}

// TaggedEvent carries a payload with its event type for ServeMulti.
type TaggedEvent struct {
	EventType string
	Data      []byte
}

// RegisterMulti registers a MultiClient by creating internal per-channel
// clients that fan into the shared Send channel.
func (h *Hub) RegisterMulti(mc *MultiClient) []*Client {
	clients := make([]*Client, len(mc.Entries))
	for i, entry := range mc.Entries {
		client := &Client{
			Channel:    entry.Channel,
			FilterFunc: entry.FilterFunc,
			Send:       make(chan []byte, 32),
			Done:       mc.Done,
		}
		clients[i] = client
		h.Register(client)

		// Fan each internal client's Send into the multi-client's tagged Send
		go func(c *Client, eventType string) {
			for {
				select {
				case <-mc.Done:
					return
				case data, ok := <-c.Send:
					if !ok {
						return
					}
					select {
					case mc.Send <- TaggedEvent{EventType: eventType, Data: data}:
					case <-mc.Done:
						return
					}
				}
			}
		}(client, entry.EventType)
	}
	return clients
}

// UnregisterMulti removes all internal clients for a multi-client.
func (h *Hub) UnregisterMulti(clients []*Client) {
	for _, c := range clients {
		h.Unregister(c)
	}
}

// ServeMulti writes tagged SSE events to the response from a MultiClient.
func ServeMulti(w http.ResponseWriter, r *http.Request, mc *MultiClient) {
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
		case <-mc.Done:
			return
		case tagged := <-mc.Send:
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", tagged.EventType, tagged.Data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// Feed injects an event into the hub from an external source (e.g. NATS).
// This decouples event production from the hub's client management, allowing
// any transport to feed events into the SSE fan-out.
func (h *Hub) Feed(channel string, payload []byte) {
	h.broadcast(channel, payload)
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
