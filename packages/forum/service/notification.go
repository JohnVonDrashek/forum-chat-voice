package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/forum/store"
)

// Notification types used in the notification table and webhook payloads.
const (
	NotifTypeReply   = "reply"
	NotifTypeMention = "mention"
)

var mentionRe = regexp.MustCompile(`@(\w+)`)

// pushItem holds a notification to be pushed to the Forumline app.
type pushItem struct {
	ForumlineUserID string
	Type            string
	Title           string
	Body            string
	Link            string
}

// NotificationConfig holds config needed for notification push.
type NotificationConfig struct {
	ForumlineURL string
	// ServiceKey is the bearer token for authenticating webhook pushes
	// to the Forumline app. If empty, webhook push is disabled.
	ServiceKey string
}

// NotificationService handles notification business logic.
type NotificationService struct {
	Store  *store.Store
	Config *NotificationConfig
}

// NewNotificationService creates a new NotificationService.
func NewNotificationService(s *store.Store, cfg *NotificationConfig) *NotificationService {
	return &NotificationService{Store: s, Config: cfg}
}

// GeneratePostNotifications creates notification rows for @mentions and thread reply notifications.
// After inserting locally, it batches and pushes to forumline for users with a forumline_id.
func (ns *NotificationService) GeneratePostNotifications(threadID, postID, authorID uuid.UUID, content string, replyToID *uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Look up author username
	authorUsername, _ := ns.Store.GetUsername(ctx, authorID)
	if authorUsername == "" {
		authorUsername = "Someone"
	}

	// Look up thread title and OP author
	threadTitle, threadAuthorID, _ := ns.Store.GetThreadTitleAndAuthor(ctx, threadID)

	threadLink := fmt.Sprintf("/t/%s", threadID)
	notified := map[uuid.UUID]bool{authorID: true} // don't notify the post author

	// Collect forumline push items
	var pushItems []pushItem

	// helper: insert local notification and queue forumline push
	notifyUser := func(userID uuid.UUID, notifType, title, body, link string) {
		if err := ns.Store.InsertNotification(ctx, userID, notifType, title, body, link); err != nil {
			log.Printf("[notifications] failed to insert for %s: %v", userID, err)
			return
		}

		// Look up forumline_id for push
		forumlineID, _ := ns.Store.GetForumlineID(ctx, userID)
		if forumlineID != nil && *forumlineID != "" {
			pushItems = append(pushItems, pushItem{
				ForumlineUserID: *forumlineID,
				Type:            notifType,
				Title:           title,
				Body:            body,
				Link:            link,
			})
		}
	}

	// 1. Notify thread author about the reply
	if threadAuthorID != (uuid.UUID{}) && !notified[threadAuthorID] {
		notified[threadAuthorID] = true
		notifyUser(threadAuthorID, NotifTypeReply,
			fmt.Sprintf("<strong>%s</strong> replied in \"%s\"", authorUsername, threadTitle),
			truncate(content, 200), threadLink)
	}

	// 2. If this is a reply to a specific post, notify that post's author
	if replyToID != nil && *replyToID != (uuid.UUID{}) {
		replyAuthorID, _ := ns.Store.GetPostAuthor(ctx, *replyToID)
		if replyAuthorID != (uuid.UUID{}) && !notified[replyAuthorID] {
			notified[replyAuthorID] = true
			notifyUser(replyAuthorID, NotifTypeReply,
				fmt.Sprintf("<strong>%s</strong> replied to your post in \"%s\"", authorUsername, threadTitle),
				truncate(content, 200), threadLink)
		}
	}

	// 3. Notify @mentioned users
	matches := mentionRe.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		username := strings.ToLower(match[1])
		mentionedUserID, err := ns.Store.GetUserIDByUsername(ctx, username)
		if err != nil || mentionedUserID == (uuid.UUID{}) {
			continue
		}
		if !notified[mentionedUserID] {
			notified[mentionedUserID] = true
			notifyUser(mentionedUserID, NotifTypeMention,
				fmt.Sprintf("<strong>%s</strong> mentioned you in \"%s\"", authorUsername, threadTitle),
				truncate(content, 200), threadLink)
		}
	}

	// Push batch to forumline
	if len(pushItems) > 0 {
		ns.pushToForumline(pushItems)
	}
}

// pushToForumline sends a batch of notifications to the forumline API webhook.
// Authenticates using the ZITADEL_SERVICE_USER_PAT service key.
func (ns *NotificationService) pushToForumline(items []pushItem) {
	if ns.Config.ForumlineURL == "" || ns.Config.ServiceKey == "" {
		return
	}

	serviceKey := ns.Config.ServiceKey

	var endpoint string
	var payload []byte
	if len(items) == 1 {
		endpoint = ns.Config.ForumlineURL + "/api/webhooks/notification"
		wrapper := map[string]interface{}{
			"forumline_user_id": items[0].ForumlineUserID,
			"type":              items[0].Type,
			"title":             items[0].Title,
			"body":              items[0].Body,
			"link":              items[0].Link,
		}
		payload, _ = json.Marshal(wrapper)
	} else {
		endpoint = ns.Config.ForumlineURL + "/api/webhooks/notifications"
		wrapper := map[string]interface{}{
			"items": items,
		}
		payload, _ = json.Marshal(wrapper)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		log.Printf("[notifications] failed to create forumline request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+serviceKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[notifications] push to forumline failed: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("[notifications] forumline webhook returned HTTP %d (body: %s)", resp.StatusCode, string(respBody))
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
