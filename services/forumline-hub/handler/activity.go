package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-hub/store"
)

type ActivityHandler struct {
	store *store.Store
}

func NewActivityHandler(s *store.Store) *ActivityHandler {
	return &ActivityHandler{store: s}
}

type activityThread struct {
	ID         string           `json:"id"`
	Title      string           `json:"title"`
	PostCount  int              `json:"post_count"`
	LastPostAt *string          `json:"last_post_at"`
	CreatedAt  string           `json:"created_at"`
	Author     activityAuthor   `json:"author"`
	Category   activityCategory `json:"category"`
}

type activityAuthor struct {
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

type activityCategory struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type activityItem struct {
	ThreadID    string  `json:"thread_id"`
	ThreadTitle string  `json:"thread_title"`
	Author      string  `json:"author"`
	AvatarURL   *string `json:"avatar_url"`
	Action      string  `json:"action"`
	ForumName   string  `json:"forum_name"`
	ForumDomain string  `json:"forum_domain"`
	Category    string  `json:"category"`
	Timestamp   string  `json:"timestamp"`
}

func (h *ActivityHandler) HandleGetActivity(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	memberships, err := h.store.ListMemberships(r.Context(), userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "failed to fetch memberships")
		return
	}
	if len(memberships) == 0 {
		httpkit.WriteJSON(w, http.StatusOK, []activityItem{})
		return
	}
	items, err := fetchActivityItems(r.Context(), memberships)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "failed to fetch activity")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, items)
}

func fetchActivityItems(ctx context.Context, memberships []store.Membership) ([]activityItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var mu sync.Mutex
	var items []activityItem
	var wg sync.WaitGroup

	for _, m := range memberships {
		wg.Add(1)
		go func(webBase, forumName, forumDomain string) {
			defer wg.Done()
			threads, err := fetchForumThreads(ctx, webBase)
			if err != nil {
				log.Printf("[activity] failed to fetch threads from %s: %v", forumDomain, err)
				return
			}
			mu.Lock()
			for _, t := range threads {
				action := "posted"
				ts := t.CreatedAt
				if t.PostCount > 0 && t.LastPostAt != nil {
					action = "active"
					ts = *t.LastPostAt
				}
				author := t.Author.Username
				if t.Author.DisplayName != nil && *t.Author.DisplayName != "" {
					author = *t.Author.DisplayName
				}
				items = append(items, activityItem{
					ThreadID:    t.ID,
					ThreadTitle: t.Title,
					Author:      author,
					AvatarURL:   t.Author.AvatarURL,
					Action:      action,
					ForumName:   forumName,
					ForumDomain: forumDomain,
					Category:    t.Category.Name,
					Timestamp:   ts,
				})
			}
			mu.Unlock()
		}(m.WebBase, m.ForumName, m.ForumDomain)
	}

	wg.Wait()

	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})
	if len(items) > 20 {
		items = items[:20]
	}
	if items == nil {
		items = []activityItem{}
	}
	return items, nil
}

func fetchForumThreads(ctx context.Context, webBase string) ([]activityThread, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", webBase+"/api/threads?limit=10", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}
	var threads []activityThread
	if err := json.NewDecoder(resp.Body).Decode(&threads); err != nil {
		return nil, err
	}
	return threads, nil
}
