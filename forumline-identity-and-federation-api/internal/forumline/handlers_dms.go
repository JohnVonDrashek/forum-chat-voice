package forumline

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
)

type DirectMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
}

type ConversationMember struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

type Conversation struct {
	ID              string               `json:"id"`
	IsGroup         bool                 `json:"isGroup"`
	Name            *string              `json:"name"`
	Members         []ConversationMember `json:"members"`
	LastMessage     string               `json:"lastMessage"`
	LastMessageTime string               `json:"lastMessageTime"`
	UnreadCount     int                  `json:"unreadCount"`
}

// HandleListConversations lists all conversations for the authenticated user.
func (h *Handlers) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	rows, err := h.Pool.Query(ctx,
		`SELECT
			c.id, c.is_group, c.name,
			COALESCE(m.content, ''), COALESCE(m.created_at, c.created_at),
			(SELECT count(*) FROM forumline_direct_messages dm2
			 WHERE dm2.conversation_id = c.id
			   AND dm2.sender_id != $1
			   AND dm2.created_at > cm.last_read_at)
		 FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 LEFT JOIN LATERAL (
			SELECT content, created_at FROM forumline_direct_messages
			WHERE conversation_id = c.id
			ORDER BY created_at DESC LIMIT 1
		 ) m ON true
		 ORDER BY COALESCE(m.created_at, c.created_at) DESC
		 LIMIT 100`, userID,
	)
	if err != nil {
		log.Printf("[DMs] HandleListConversations query error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch conversations"})
		return
	}
	defer rows.Close()

	type convoRow struct {
		id              string
		isGroup         bool
		name            *string
		lastMessage     string
		lastMessageTime time.Time
		unreadCount     int
	}

	var convoRows []convoRow
	var convoIDs []string

	for rows.Next() {
		var cr convoRow
		if err := rows.Scan(&cr.id, &cr.isGroup, &cr.name, &cr.lastMessage, &cr.lastMessageTime, &cr.unreadCount); err != nil {
			continue
		}
		convoRows = append(convoRows, cr)
		convoIDs = append(convoIDs, cr.id)
	}

	if len(convoIDs) == 0 {
		writeJSON(w, http.StatusOK, []Conversation{})
		return
	}

	// Fetch all members for all conversations
	memberRows, err := h.Pool.Query(ctx,
		`SELECT cm.conversation_id, cm.user_id, p.username, p.display_name, p.avatar_url
		 FROM forumline_conversation_members cm
		 JOIN forumline_profiles p ON p.id = cm.user_id
		 WHERE cm.conversation_id = ANY($1)`, convoIDs,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch members"})
		return
	}
	defer memberRows.Close()

	membersMap := make(map[string][]ConversationMember)
	for memberRows.Next() {
		var convoID, userIDm, username, displayName string
		var avatarURL *string
		if err := memberRows.Scan(&convoID, &userIDm, &username, &displayName, &avatarURL); err != nil {
			continue
		}
		name := displayName
		if name == "" {
			name = username
		}
		membersMap[convoID] = append(membersMap[convoID], ConversationMember{
			ID:          userIDm,
			Username:    username,
			DisplayName: name,
			AvatarURL:   avatarURL,
		})
	}

	conversations := make([]Conversation, 0, len(convoRows))
	for _, cr := range convoRows {
		members := membersMap[cr.id]
		if members == nil {
			members = []ConversationMember{}
		}
		conversations = append(conversations, Conversation{
			ID:              cr.id,
			IsGroup:         cr.isGroup,
			Name:            cr.name,
			Members:         members,
			LastMessage:     cr.lastMessage,
			LastMessageTime: cr.lastMessageTime.Format(time.RFC3339),
			UnreadCount:     cr.unreadCount,
		})
	}

	writeJSON(w, http.StatusOK, conversations)
}

// HandleGetConversation returns a single conversation's metadata.
func (h *Handlers) HandleGetConversation(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}

	var id string
	var isGroup bool
	var name *string
	var lastMessage string
	var lastMessageTime time.Time
	var unreadCount int

	err := h.Pool.QueryRow(ctx,
		`SELECT
			c.id, c.is_group, c.name,
			COALESCE(m.content, ''), COALESCE(m.created_at, c.created_at),
			(SELECT count(*) FROM forumline_direct_messages dm2
			 WHERE dm2.conversation_id = c.id
			   AND dm2.sender_id != $1
			   AND dm2.created_at > cm.last_read_at)
		 FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 LEFT JOIN LATERAL (
			SELECT content, created_at FROM forumline_direct_messages
			WHERE conversation_id = c.id
			ORDER BY created_at DESC LIMIT 1
		 ) m ON true
		 WHERE c.id = $2`,
		userID, conversationID,
	).Scan(&id, &isGroup, &name, &lastMessage, &lastMessageTime, &unreadCount)

	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}

	// Fetch members
	memberRows, err := h.Pool.Query(ctx,
		`SELECT cm.user_id, p.username, p.display_name, p.avatar_url
		 FROM forumline_conversation_members cm
		 JOIN forumline_profiles p ON p.id = cm.user_id
		 WHERE cm.conversation_id = $1`, conversationID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch members"})
		return
	}
	defer memberRows.Close()

	members := make([]ConversationMember, 0)
	for memberRows.Next() {
		var userIDm, username, displayName string
		var avatarURL *string
		if err := memberRows.Scan(&userIDm, &username, &displayName, &avatarURL); err != nil {
			continue
		}
		n := displayName
		if n == "" {
			n = username
		}
		members = append(members, ConversationMember{
			ID:          userIDm,
			Username:    username,
			DisplayName: n,
			AvatarURL:   avatarURL,
		})
	}

	writeJSON(w, http.StatusOK, Conversation{
		ID:              id,
		IsGroup:         isGroup,
		Name:            name,
		Members:         members,
		LastMessage:     lastMessage,
		LastMessageTime: lastMessageTime.Format(time.RFC3339),
		UnreadCount:     unreadCount,
	})
}

// HandleGetMessages returns messages in a conversation.
func (h *Handlers) HandleGetMessages(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}

	// Verify membership
	var isMember bool
	h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2)`,
		conversationID, userID,
	).Scan(&isMember)
	if !isMember {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}

	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = int(math.Min(float64(l), 100))
	}
	before := r.URL.Query().Get("before")

	var messages []DirectMessage

	if before != "" {
		rows, err := h.Pool.Query(ctx,
			`SELECT id, conversation_id, sender_id, content, created_at
			 FROM forumline_direct_messages
			 WHERE conversation_id = $1
			   AND created_at < (SELECT created_at FROM forumline_direct_messages WHERE id = $2)
			 ORDER BY created_at DESC
			 LIMIT $3`,
			conversationID, before, limit,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch messages"})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var msg DirectMessage
			if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt); err != nil {
				continue
			}
			messages = append(messages, msg)
		}
	} else {
		rows, err := h.Pool.Query(ctx,
			`SELECT id, conversation_id, sender_id, content, created_at
			 FROM forumline_direct_messages
			 WHERE conversation_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			conversationID, limit,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch messages"})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var msg DirectMessage
			if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt); err != nil {
				continue
			}
			messages = append(messages, msg)
		}
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

// HandleSendMessage sends a message in a conversation.
func (h *Handlers) HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}

	// Verify membership
	var isMember bool
	h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2)`,
		conversationID, userID,
	).Scan(&isMember)
	if !isMember {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
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

	var msg DirectMessage
	err := h.Pool.QueryRow(ctx,
		`INSERT INTO forumline_direct_messages (conversation_id, sender_id, content)
		 VALUES ($1, $2, $3)
		 RETURNING id, conversation_id, sender_id, content, created_at`,
		conversationID, userID, content,
	).Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content, &msg.CreatedAt)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to send message"})
		return
	}

	// Update conversation updated_at
	h.Pool.Exec(ctx, `UPDATE forumline_conversations SET updated_at = now() WHERE id = $1`, conversationID)

	writeJSON(w, http.StatusCreated, msg)
}

// HandleMarkRead marks a conversation as read for the authenticated user.
func (h *Handlers) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}

	_, err := h.Pool.Exec(ctx,
		`UPDATE forumline_conversation_members SET last_read_at = now()
		 WHERE conversation_id = $1 AND user_id = $2`,
		conversationID, userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// HandleGetOrCreateDM finds or creates a 1:1 conversation with another user.
func (h *Handlers) HandleGetOrCreateDM(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId is required"})
		return
	}
	if body.UserID == userID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot message yourself"})
		return
	}

	// Verify other user exists
	var exists bool
	h.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_profiles WHERE id = $1)`, body.UserID,
	).Scan(&exists)
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	// Find existing 1:1 conversation between these two users
	var convoID string
	err := h.Pool.QueryRow(ctx,
		`SELECT c.id FROM forumline_conversations c
		 WHERE c.is_group = false
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $1)
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $2)
		   AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2`,
		userID, body.UserID,
	).Scan(&convoID)

	if err != nil {
		// Create new 1:1 conversation
		tx, txErr := h.Pool.Begin(ctx)
		if txErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create conversation"})
			return
		}
		defer tx.Rollback(ctx)

		err = tx.QueryRow(ctx,
			`INSERT INTO forumline_conversations (is_group, created_by) VALUES (false, $1) RETURNING id`, userID,
		).Scan(&convoID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create conversation"})
			return
		}

		_, err = tx.Exec(ctx,
			`INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
			convoID, userID, body.UserID,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to add members"})
			return
		}

		if err = tx.Commit(ctx); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create conversation"})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": convoID})
}

// HandleCreateConversation creates a new group conversation.
func (h *Handlers) HandleCreateConversation(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		MemberIDs []string `json:"memberIds"`
		Name      string   `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if len(body.MemberIDs) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group must have at least 2 other members"})
		return
	}
	if len(body.MemberIDs) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group cannot exceed 50 members"})
		return
	}

	name := trimString(body.Name)
	if name == "" || len(name) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group name must be 1-100 characters"})
		return
	}

	// Verify all members exist and aren't the creator
	allMembers := append([]string{userID}, body.MemberIDs...)
	seen := make(map[string]bool)
	var uniqueMembers []string
	for _, id := range allMembers {
		if !seen[id] && id != "" {
			seen[id] = true
			uniqueMembers = append(uniqueMembers, id)
		}
	}

	if len(uniqueMembers) < 3 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group must have at least 3 members including yourself"})
		return
	}

	// Verify all users exist
	var existCount int
	h.Pool.QueryRow(ctx,
		`SELECT count(*) FROM forumline_profiles WHERE id = ANY($1)`, uniqueMembers,
	).Scan(&existCount)
	if existCount != len(uniqueMembers) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "One or more users not found"})
		return
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create group"})
		return
	}
	defer tx.Rollback(ctx)

	var convoID string
	err = tx.QueryRow(ctx,
		`INSERT INTO forumline_conversations (is_group, name, created_by) VALUES (true, $1, $2) RETURNING id`,
		name, userID,
	).Scan(&convoID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create group"})
		return
	}

	// Batch insert all members in a single query
	valueStrings := make([]string, len(uniqueMembers))
	args := make([]interface{}, 0, len(uniqueMembers)+1)
	args = append(args, convoID)
	for i, memberID := range uniqueMembers {
		valueStrings[i] = fmt.Sprintf("($1, $%d)", i+2)
		args = append(args, memberID)
	}
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES %s`,
			strings.Join(valueStrings, ",")),
		args...,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to add members"})
		return
	}

	if err = tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create group"})
		return
	}

	// Fetch full conversation to return
	profiles := fetchProfilesByIDs(ctx, h.Pool, uniqueMembers)
	members := make([]ConversationMember, 0, len(uniqueMembers))
	for _, id := range uniqueMembers {
		p := profiles[id]
		m := ConversationMember{ID: id}
		if p != nil {
			m.Username = p.Username
			m.DisplayName = p.DisplayName
			if m.DisplayName == "" {
				m.DisplayName = p.Username
			}
			m.AvatarURL = p.AvatarURL
		}
		members = append(members, m)
	}

	writeJSON(w, http.StatusCreated, Conversation{
		ID:              convoID,
		IsGroup:         true,
		Name:            &name,
		Members:         members,
		LastMessage:     "",
		LastMessageTime: time.Now().Format(time.RFC3339),
		UnreadCount:     0,
	})
}

// HandleUpdateConversation updates a group conversation (rename, add/remove members).
func (h *Handlers) HandleUpdateConversation(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	// Verify membership and that it's a group
	var isGroup bool
	err := h.Pool.QueryRow(ctx,
		`SELECT c.is_group FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 WHERE c.id = $2`,
		userID, conversationID,
	).Scan(&isGroup)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if !isGroup {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot modify a 1:1 conversation"})
		return
	}

	var body struct {
		Name         *string  `json:"name"`
		AddMembers   []string `json:"addMembers"`
		RemoveMembers []string `json:"removeMembers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.Name != nil {
		name := trimString(*body.Name)
		if name == "" || len(name) > 100 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Group name must be 1-100 characters"})
			return
		}
		_, err = h.Pool.Exec(ctx,
			`UPDATE forumline_conversations SET name = $1 WHERE id = $2`, name, conversationID,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update group"})
			return
		}
	}

	// Batch add members: insert only valid profiles in a single query
	if len(body.AddMembers) > 0 {
		h.Pool.Exec(ctx,
			`INSERT INTO forumline_conversation_members (conversation_id, user_id)
			 SELECT $1, p.id FROM forumline_profiles p WHERE p.id = ANY($2)
			 ON CONFLICT DO NOTHING`,
			conversationID, body.AddMembers,
		)
	}

	// Batch remove members (excluding self)
	if len(body.RemoveMembers) > 0 {
		filtered := make([]string, 0, len(body.RemoveMembers))
		for _, id := range body.RemoveMembers {
			if id != userID {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) > 0 {
			h.Pool.Exec(ctx,
				`DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = ANY($2)`,
				conversationID, filtered,
			)
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// HandleLeaveConversation removes the authenticated user from a group conversation.
func (h *Handlers) HandleLeaveConversation(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	conversationID := chi.URLParam(r, "conversationId")
	ctx := r.Context()

	// Verify it's a group
	var isGroup bool
	err := h.Pool.QueryRow(ctx,
		`SELECT c.is_group FROM forumline_conversations c
		 JOIN forumline_conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
		 WHERE c.id = $2`,
		userID, conversationID,
	).Scan(&isGroup)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	if !isGroup {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot leave a 1:1 conversation"})
		return
	}

	_, err = h.Pool.Exec(ctx,
		`DELETE FROM forumline_conversation_members WHERE conversation_id = $1 AND user_id = $2`,
		conversationID, userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to leave conversation"})
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
		FilterFunc: func(data map[string]interface{}) bool {
			// Check if user is in member_ids array
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
		Send: make(chan []byte, 32),
		Done: make(chan struct{}),
	}

	h.SSEHub.Register(client)
	defer func() {
		h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	shared.ServeSSE(w, r, client)
}

// resolveConversationID finds or creates a 1:1 conversation for a legacy userId param.
func (h *Handlers) resolveConversationID(w http.ResponseWriter, r *http.Request) string {
	userID := shared.UserIDFromContext(r.Context())
	otherUserID := chi.URLParam(r, "userId")
	ctx := r.Context()

	if otherUserID == "" || otherUserID == userID {
		return ""
	}

	// Find existing 1:1 conversation
	var convoID string
	err := h.Pool.QueryRow(ctx,
		`SELECT c.id FROM forumline_conversations c
		 WHERE c.is_group = false
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $1)
		   AND EXISTS(SELECT 1 FROM forumline_conversation_members WHERE conversation_id = c.id AND user_id = $2)
		   AND (SELECT count(*) FROM forumline_conversation_members WHERE conversation_id = c.id) = 2`,
		userID, otherUserID,
	).Scan(&convoID)

	if err != nil {
		// Create new 1:1 conversation
		tx, txErr := h.Pool.Begin(ctx)
		if txErr != nil {
			return ""
		}
		defer tx.Rollback(ctx)

		err = tx.QueryRow(ctx,
			`INSERT INTO forumline_conversations (is_group, created_by) VALUES (false, $1) RETURNING id`, userID,
		).Scan(&convoID)
		if err != nil {
			return ""
		}

		_, err = tx.Exec(ctx,
			`INSERT INTO forumline_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
			convoID, userID, otherUserID,
		)
		if err != nil {
			return ""
		}

		if err = tx.Commit(ctx); err != nil {
			return ""
		}
	}

	return convoID
}

// withConversationID injects a conversationId URL param into the chi route context
// while preserving all other context values (auth, etc.).
func withConversationID(r *http.Request, convoID string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("conversationId", convoID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// HandleLegacyGetMessages handles GET /api/dms/{userId} by resolving to a conversation.
func (h *Handlers) HandleLegacyGetMessages(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	h.HandleGetMessages(w, withConversationID(r, convoID))
}

// HandleLegacySendMessage handles POST /api/dms/{userId} by resolving to a conversation.
func (h *Handlers) HandleLegacySendMessage(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	h.HandleSendMessage(w, withConversationID(r, convoID))
}

// HandleLegacyMarkRead handles POST /api/dms/{userId}/read by resolving to a conversation.
func (h *Handlers) HandleLegacyMarkRead(w http.ResponseWriter, r *http.Request) {
	convoID := h.resolveConversationID(w, r)
	if convoID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Conversation not found"})
		return
	}
	h.HandleMarkRead(w, withConversationID(r, convoID))
}
