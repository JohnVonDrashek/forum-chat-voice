package forumline

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/johnvondrashek/forumline/go-services/internal/shared"
)

type DirectMessage struct {
	ID          string    `json:"id"`
	SenderID    string    `json:"sender_id"`
	RecipientID string    `json:"recipient_id"`
	Content     string    `json:"content"`
	Read        bool      `json:"read"`
	CreatedAt   time.Time `json:"created_at"`
}

type Conversation struct {
	RecipientID        string  `json:"recipientId"`
	RecipientName      string  `json:"recipientName"`
	RecipientAvatarURL *string `json:"recipientAvatarUrl"`
	LastMessage        string  `json:"lastMessage"`
	LastMessageTime    string  `json:"lastMessageTime"`
	UnreadCount        int     `json:"unreadCount"`
}

// HandleListConversations lists DM conversations for the authenticated user.
func (h *Handlers) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	rows, err := h.Pool.Query(ctx,
		`SELECT id, sender_id, recipient_id, content, read, created_at
		 FROM forumline_direct_messages
		 WHERE sender_id = $1 OR recipient_id = $1
		 ORDER BY created_at DESC
		 LIMIT 500`, userID,
	)
	if err != nil {
		log.Printf("[DMs] HandleListConversations query error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch conversations"})
		return
	}
	defer rows.Close()

	type convData struct {
		recipientID     string
		lastMessage     string
		lastMessageTime time.Time
		unreadCount     int
	}

	convMap := make(map[string]*convData)
	var otherIDs []string

	for rows.Next() {
		var msg DirectMessage
		if err := rows.Scan(&msg.ID, &msg.SenderID, &msg.RecipientID, &msg.Content, &msg.Read, &msg.CreatedAt); err != nil {
			continue
		}

		otherID := msg.RecipientID
		if msg.SenderID != userID {
			otherID = msg.SenderID
		}

		if _, exists := convMap[otherID]; !exists {
			convMap[otherID] = &convData{
				recipientID:     otherID,
				lastMessage:     msg.Content,
				lastMessageTime: msg.CreatedAt,
			}
			otherIDs = append(otherIDs, otherID)
		}

		if msg.RecipientID == userID && !msg.Read {
			convMap[otherID].unreadCount++
		}
	}

	if len(otherIDs) == 0 {
		writeJSON(w, http.StatusOK, []Conversation{})
		return
	}

	// Fetch profiles
	profiles := fetchProfilesByIDs(ctx, h.Pool, otherIDs)

	// Build response
	conversations := make([]Conversation, 0, len(otherIDs))
	for _, id := range otherIDs {
		cd := convMap[id]
		profile := profiles[id]
		name := "Unknown"
		var avatarURL *string
		if profile != nil {
			if profile.DisplayName != "" {
				name = profile.DisplayName
			} else {
				name = profile.Username
			}
			avatarURL = profile.AvatarURL
		}
		conversations = append(conversations, Conversation{
			RecipientID:        cd.recipientID,
			RecipientName:      name,
			RecipientAvatarURL: avatarURL,
			LastMessage:        cd.lastMessage,
			LastMessageTime:    cd.lastMessageTime.Format(time.RFC3339),
			UnreadCount:        cd.unreadCount,
		})
	}

	writeJSON(w, http.StatusOK, conversations)
}

// HandleGetMessages returns messages between the authenticated user and another user.
func (h *Handlers) HandleGetMessages(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	otherUserID := chi.URLParam(r, "userId")
	ctx := r.Context()

	if otherUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
		return
	}
	if otherUserID == userID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot message yourself"})
		return
	}

	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = int(math.Min(float64(l), 100))
	}
	before := r.URL.Query().Get("before")

	var rows interface{ Close() }
	var err error

	if before != "" {
		rows2, err2 := h.Pool.Query(ctx,
			`SELECT id, sender_id, recipient_id, content, read, created_at
			 FROM forumline_direct_messages
			 WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
			   AND id < $3
			 ORDER BY created_at DESC
			 LIMIT $4`,
			userID, otherUserID, before, limit,
		)
		rows = rows2
		err = err2
	} else {
		rows2, err2 := h.Pool.Query(ctx,
			`SELECT id, sender_id, recipient_id, content, read, created_at
			 FROM forumline_direct_messages
			 WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
			 ORDER BY created_at DESC
			 LIMIT $3`,
			userID, otherUserID, limit,
		)
		rows = rows2
		err = err2
	}

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch messages"})
		return
	}

	// We need to close and iterate
	pgxRows := rows.(interface {
		Close()
		Next() bool
		Scan(dest ...interface{}) error
	})
	defer pgxRows.Close()

	var messages []DirectMessage
	for pgxRows.Next() {
		var msg DirectMessage
		if err := pgxRows.Scan(&msg.ID, &msg.SenderID, &msg.RecipientID, &msg.Content, &msg.Read, &msg.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, msg)
	}

	// Reverse to chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	if messages == nil {
		messages = []DirectMessage{}
	}

	writeJSON(w, http.StatusOK, messages)
}

// HandleSendMessage sends a DM to another user.
func (h *Handlers) HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	recipientID := chi.URLParam(r, "userId")
	ctx := r.Context()

	if recipientID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
		return
	}
	if recipientID == userID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot message yourself"})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	content := trimString(body.Content)
	if content == "" || len(content) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Message must be 1-2000 characters"})
		return
	}

	// Verify recipient exists
	var recipientExists bool
	h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1)`, recipientID,
	).Scan(&recipientExists)

	if !recipientExists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Recipient not found"})
		return
	}

	// Insert message
	var msg DirectMessage
	err := h.Pool.QueryRow(ctx,
		`INSERT INTO forumline_direct_messages (sender_id, recipient_id, content)
		 VALUES ($1, $2, $3)
		 RETURNING id, sender_id, recipient_id, content, read, created_at`,
		userID, recipientID, content,
	).Scan(&msg.ID, &msg.SenderID, &msg.RecipientID, &msg.Content, &msg.Read, &msg.CreatedAt)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to send message"})
		return
	}

	writeJSON(w, http.StatusCreated, msg)
}

// HandleMarkRead marks all messages from a specific user as read.
func (h *Handlers) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	otherUserID := chi.URLParam(r, "userId")
	ctx := r.Context()

	if otherUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
		return
	}

	_, err := h.Pool.Exec(ctx,
		`UPDATE forumline_direct_messages SET read = true
		 WHERE sender_id = $1 AND recipient_id = $2 AND read = false`,
		otherUserID, userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark messages as read"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// HandleDMStream provides SSE for real-time DM messages.
func (h *Handlers) HandleDMStream(w http.ResponseWriter, r *http.Request) {
	// Authenticate via query param (EventSource can't set headers)
	tokenStr := r.URL.Query().Get("access_token")
	if tokenStr == "" {
		tokenStr = extractTokenFromRequest(r)
	}
	if tokenStr == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return
	}

	claims, err := shared.ValidateJWT(tokenStr)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}

	userID := claims.Subject

	client := &shared.SSEClient{
		Channel: "dm_changes",
		Filter:  map[string]string{"recipient_id": userID},
		Send:    make(chan []byte, 32),
		Done:    make(chan struct{}),
	}

	h.SSEHub.Register(client)
	defer func() {
		h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	shared.ServeSSE(w, r, client)
}
