package forumline

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
	webpush "github.com/SherClockHolmes/webpush-go"
	"golang.org/x/crypto/bcrypt"
)

// --- Memberships ---

func (h *Handlers) HandleGetMemberships(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	rows, err := h.Pool.Query(ctx,
		`SELECT m.id, m.joined_at, m.forum_authed_at, m.notifications_muted,
		        f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities
		 FROM forumline_memberships m
		 JOIN forumline_forums f ON f.id = m.forum_id
		 WHERE m.user_id = $1
		 ORDER BY m.joined_at DESC`, userID,
	)
	if err != nil {
		log.Printf("[Memberships] HandleGetMemberships query error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch memberships"})
		return
	}
	defer rows.Close()

	type membership struct {
		ForumDomain        string   `json:"forum_domain"`
		ForumName          string   `json:"forum_name"`
		ForumIconURL       *string  `json:"forum_icon_url"`
		APIBase            string   `json:"api_base"`
		WebBase            string   `json:"web_base"`
		Capabilities       []string `json:"capabilities"`
		JoinedAt           string   `json:"joined_at"`
		ForumAuthedAt      *string  `json:"forum_authed_at"`
		NotificationsMuted bool     `json:"notifications_muted"`
	}

	var memberships []membership
	for rows.Next() {
		var m membership
		var id string
		var joinedAt time.Time
		var forumAuthedAt *time.Time
		var notifMuted bool

		if err := rows.Scan(&id, &joinedAt, &forumAuthedAt, &notifMuted,
			&m.ForumDomain, &m.ForumName, &m.ForumIconURL, &m.APIBase, &m.WebBase, &m.Capabilities); err != nil {
			continue
		}
		m.JoinedAt = joinedAt.Format(time.RFC3339)
		if forumAuthedAt != nil {
			s := forumAuthedAt.Format(time.RFC3339)
			m.ForumAuthedAt = &s
		}
		m.NotificationsMuted = notifMuted
		memberships = append(memberships, m)
	}

	if memberships == nil {
		memberships = []membership{}
	}

	writeJSON(w, http.StatusOK, memberships)
}

func (h *Handlers) HandleUpdateMembershipAuth(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
		Authed      *bool  `json:"authed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" || body.Authed == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain or authed"})
		return
	}

	forumID := getForumIDByDomain(ctx, h.Pool, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}

	var authedAt interface{}
	if *body.Authed {
		authedAt = "now()"
		_, err := h.Pool.Exec(ctx,
			`UPDATE forumline_memberships SET forum_authed_at = now()
			 WHERE user_id = $1 AND forum_id = $2`, userID, forumID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update auth state"})
			return
		}
	} else {
		_, err := h.Pool.Exec(ctx,
			`UPDATE forumline_memberships SET forum_authed_at = NULL
			 WHERE user_id = $1 AND forum_id = $2`, userID, forumID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update auth state"})
			return
		}
		_ = authedAt
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handlers) HandleToggleMembershipMute(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
		Muted       *bool  `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" || body.Muted == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain or muted"})
		return
	}

	forumID := getForumIDByDomain(ctx, h.Pool, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}

	_, err := h.Pool.Exec(ctx,
		`UPDATE forumline_memberships SET notifications_muted = $1
		 WHERE user_id = $2 AND forum_id = $3`, *body.Muted, userID, forumID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update mute state"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handlers) HandleJoinForum(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain"})
		return
	}

	// Look up forum by domain
	forumID := getForumIDByDomain(ctx, h.Pool, body.ForumDomain)

	// If not found, fetch manifest and auto-register
	if forumID == "" {
		manifest, err := fetchForumManifest(body.ForumDomain)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found and manifest fetch failed"})
			return
		}

		err = h.Pool.QueryRow(ctx,
			`INSERT INTO forumline_forums (domain, name, icon_url, api_base, web_base, capabilities, approved)
			 VALUES ($1, $2, $3, $4, $5, $6, true)
			 ON CONFLICT (domain) DO UPDATE SET domain = EXCLUDED.domain
			 RETURNING id`,
			manifest.Domain, manifest.Name, manifest.IconURL,
			manifest.APIBase, manifest.WebBase, manifest.Capabilities,
		).Scan(&forumID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to register forum"})
			return
		}
	}

	// Create membership
	_, err := h.Pool.Exec(ctx,
		`INSERT INTO forumline_memberships (user_id, forum_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, forumID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to join forum"})
		return
	}

	// Fetch full forum details with joined_at
	var domain, name, apiBase, webBase string
	var iconURL *string
	var capabilities []string
	var joinedAt time.Time

	err = h.Pool.QueryRow(ctx,
		`SELECT f.domain, f.name, f.icon_url, f.api_base, f.web_base, f.capabilities, m.joined_at
		 FROM forumline_forums f
		 JOIN forumline_memberships m ON m.forum_id = f.id
		 WHERE f.id = $1 AND m.user_id = $2`, forumID, userID,
	).Scan(&domain, &name, &iconURL, &apiBase, &webBase, &capabilities, &joinedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch forum details"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"domain":       domain,
		"name":         name,
		"icon_url":     iconURL,
		"api_base":     apiBase,
		"web_base":     webBase,
		"capabilities": capabilities,
		"joined_at":    joinedAt.Format(time.RFC3339),
	})
}

func (h *Handlers) HandleLeaveForum(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain"})
		return
	}

	forumID := getForumIDByDomain(ctx, h.Pool, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}

	_, err := h.Pool.Exec(ctx,
		`DELETE FROM forumline_memberships WHERE user_id = $1 AND forum_id = $2`,
		userID, forumID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to leave forum"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Forums ---

func (h *Handlers) HandleListForums(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	rows, err := h.Pool.Query(ctx,
		`SELECT id, domain, name, icon_url, api_base, web_base, capabilities, description, screenshot_url
		 FROM forumline_forums WHERE approved = true ORDER BY name`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch forums"})
		return
	}
	defer rows.Close()

	var forums []map[string]interface{}
	for rows.Next() {
		var id, domain, name, apiBase, webBase string
		var iconURL, description, screenshotURL *string
		var capabilities []string

		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase, &capabilities, &description, &screenshotURL); err != nil {
			continue
		}
		forum := map[string]interface{}{
			"id":             id,
			"domain":         domain,
			"name":           name,
			"icon_url":       iconURL,
			"api_base":       apiBase,
			"web_base":       webBase,
			"capabilities":   capabilities,
			"description":    description,
			"screenshot_url": screenshotURL,
		}
		forums = append(forums, forum)
	}

	if forums == nil {
		forums = []map[string]interface{}{}
	}

	writeJSON(w, http.StatusOK, forums)
}

func (h *Handlers) HandleRegisterForum(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		Domain       string   `json:"domain"`
		Name         string   `json:"name"`
		APIBase      string   `json:"api_base"`
		WebBase      string   `json:"web_base"`
		Capabilities []string `json:"capabilities"`
		Description  *string  `json:"description"`
		RedirectURIs []string `json:"redirect_uris"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.Domain == "" || body.Name == "" || body.APIBase == "" || body.WebBase == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain, name, api_base, and web_base are required"})
		return
	}

	// Validate URLs
	for _, u := range []string{body.APIBase, body.WebBase} {
		if _, err := url.ParseRequestURI(u); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid URL: %s", u)})
			return
		}
	}

	// Check quota (max 5)
	var count int
	h.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM forumline_forums WHERE owner_id = $1`, userID).Scan(&count)
	if count >= 5 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Maximum of 5 forums per user"})
		return
	}

	// Check domain uniqueness
	var domainExists bool
	h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM forumline_forums WHERE domain = $1)`, body.Domain).Scan(&domainExists)
	if domainExists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Forum with this domain is already registered"})
		return
	}

	// Create forum
	var forumID string
	err := h.Pool.QueryRow(ctx,
		`INSERT INTO forumline_forums (domain, name, api_base, web_base, capabilities, description, owner_id, approved)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, false)
		 RETURNING id`,
		body.Domain, body.Name, body.APIBase, body.WebBase,
		body.Capabilities, body.Description, userID,
	).Scan(&forumID)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to register forum"})
		return
	}

	// Generate OAuth client credentials
	clientIDBytes := make([]byte, 16)
	if _, err := rand.Read(clientIDBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate credentials"})
		return
	}
	clientID := hex.EncodeToString(clientIDBytes)

	clientSecretBytes := make([]byte, 32)
	if _, err := rand.Read(clientSecretBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate credentials"})
		return
	}
	clientSecret := hex.EncodeToString(clientSecretBytes)
	clientSecretHash, err := bcryptHash(clientSecret)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate credentials"})
		return
	}

	redirectURIs := body.RedirectURIs
	if len(redirectURIs) == 0 {
		redirectURIs = []string{body.WebBase + "/api/forumline/auth/callback"}
	}

	_, err = h.Pool.Exec(ctx,
		`INSERT INTO forumline_oauth_clients (forum_id, client_id, client_secret_hash, redirect_uris)
		 VALUES ($1, $2, $3, $4)`,
		forumID, clientID, clientSecretHash, redirectURIs,
	)
	if err != nil {
		h.Pool.Exec(ctx, `DELETE FROM forumline_forums WHERE id = $1`, forumID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create OAuth credentials"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"forum_id":      forumID,
		"client_id":     clientID,
		"client_secret": clientSecret,
		"approved":      false,
		"message":       "Forum registered. OAuth credentials generated. Forum requires approval before appearing in public listings.",
	})
}

// --- Screenshot Update (service key auth) ---

func (h *Handlers) HandleUpdateScreenshot(w http.ResponseWriter, r *http.Request) {
	// Authenticate via service role key
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("FORUMLINE_SERVICE_ROLE_KEY")
	if serviceKey == "" || token != serviceKey {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid authorization"})
		return
	}

	var body struct {
		Domain        string `json:"domain"`
		ScreenshotURL string `json:"screenshot_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Domain == "" || body.ScreenshotURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain and screenshot_url are required"})
		return
	}

	ctx := r.Context()
	tag, err := h.Pool.Exec(ctx,
		`UPDATE forumline_forums SET screenshot_url = $1, updated_at = now() WHERE domain = $2`,
		body.ScreenshotURL, body.Domain,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update screenshot"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "forum not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Identity ---

func (h *Handlers) HandleGetIdentity(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var username, displayName string
	var avatarURL, bio *string
	err := h.Pool.QueryRow(ctx,
		`SELECT username, display_name, avatar_url, bio FROM forumline_profiles WHERE id = $1`, userID,
	).Scan(&username, &displayName, &avatarURL, &bio)

	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	}

	result := map[string]interface{}{
		"forumline_id": userID,
		"username":     username,
		"display_name": displayName,
		"avatar_url":   stringOrEmpty(avatarURL),
	}
	if bio != nil && *bio != "" {
		result["bio"] = *bio
	}

	writeJSON(w, http.StatusOK, result)
}

// --- Profile Search ---

func (h *Handlers) HandleSearchProfiles(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "q parameter is required"})
		return
	}

	pattern := "%" + q + "%"
	rows, err := h.Pool.Query(ctx,
		`SELECT id, username, display_name, avatar_url
		 FROM forumline_profiles
		 WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2)
		 LIMIT 10`,
		userID, pattern,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to search profiles"})
		return
	}
	defer rows.Close()

	type profileResult struct {
		ID          string  `json:"id"`
		Username    string  `json:"username"`
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	}

	var profiles []profileResult
	for rows.Next() {
		var p profileResult
		if err := rows.Scan(&p.ID, &p.Username, &p.DisplayName, &p.AvatarURL); err != nil {
			continue
		}
		profiles = append(profiles, p)
	}

	if profiles == nil {
		profiles = []profileResult{}
	}

	writeJSON(w, http.StatusOK, profiles)
}

// --- Push Notifications ---

func (h *Handlers) HandlePush(w http.ResponseWriter, r *http.Request) {
	action := r.URL.Query().Get("action")

	if action == "notify" && r.Method == http.MethodPost {
		h.handlePushNotify(w, r)
		return
	}

	if action == "subscribe" {
		h.handlePushSubscribe(w, r)
		return
	}

	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid action query param"})
}

func (h *Handlers) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	// Authenticate
	tokenStr := extractTokenFromRequest(r)
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
	ctx := r.Context()

	if r.Method == http.MethodPost {
		var body struct {
			Endpoint string `json:"endpoint"`
			Keys     struct {
				P256dh string `json:"p256dh"`
				Auth   string `json:"auth"`
			} `json:"keys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing subscription fields"})
			return
		}

		_, err := h.Pool.Exec(ctx,
			`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
			userID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	if r.Method == http.MethodDelete {
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing endpoint"})
			return
		}
		h.Pool.Exec(ctx,
			`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
			userID, body.Endpoint,
		)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
}

func (h *Handlers) handlePushNotify(w http.ResponseWriter, r *http.Request) {
	// Auth: service key or OAuth client credentials
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Missing authorization"})
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("FORUMLINE_SERVICE_ROLE_KEY")

	if token != serviceKey {
		// Check if it's an OAuth client secret hash
		ctx := r.Context()
		var clientExists bool
		h.Pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM forumline_oauth_clients WHERE client_secret_hash = $1)`,
			token,
		).Scan(&clientExists)

		if !clientExists {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid authorization"})
			return
		}
	}

	var body struct {
		ForumlineID string `json:"forumline_id"`
		UserID      string `json:"user_id"`
		Title       string `json:"title"`
		Body        string `json:"body"`
		Link        string `json:"link"`
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.Title == "" || body.Body == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing title or body"})
		return
	}

	ctx := r.Context()
	targetUserID := body.UserID
	if targetUserID == "" && body.ForumlineID != "" {
		var id string
		err := h.Pool.QueryRow(ctx,
			`SELECT id FROM forumline_profiles WHERE id = $1`, body.ForumlineID,
		).Scan(&id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
			return
		}
		targetUserID = id
	}

	if targetUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing user_id or forumline_id"})
		return
	}

	// Check if forum is muted
	if body.ForumDomain != "" {
		forumID := getForumIDByDomain(ctx, h.Pool, body.ForumDomain)
		if forumID != "" {
			var muted *bool
			h.Pool.QueryRow(ctx,
				`SELECT notifications_muted FROM forumline_memberships
				 WHERE user_id = $1 AND forum_id = $2`, targetUserID, forumID,
			).Scan(&muted)
			if muted != nil && *muted {
				writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "skipped": "forum_muted"})
				return
			}
		}
	}

	// Send push notifications
	sent := sendPushNotifications(ctx, h.Pool, targetUserID, body.Title, body.Body, body.Link, body.ForumDomain)

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "sent": sent})
}

// sendPushNotifications sends web push to all subscriptions for a user.
func sendPushNotifications(ctx context.Context, pool *pgxpool.Pool, userID, title, body, link, forumDomain string) int {
	vapidPublicKey := os.Getenv("VAPID_PUBLIC_KEY")
	vapidPrivateKey := os.Getenv("VAPID_PRIVATE_KEY")
	vapidSubject := os.Getenv("VAPID_SUBJECT")

	if vapidPublicKey == "" || vapidPrivateKey == "" {
		return 0
	}

	rows, err := pool.Query(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID,
	)
	if err != nil {
		return 0
	}
	defer rows.Close()

	type sub struct {
		Endpoint string
		P256dh   string
		Auth     string
	}

	var subs []sub
	for rows.Next() {
		var s sub
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			continue
		}
		subs = append(subs, s)
	}

	if len(subs) == 0 {
		return 0
	}

	payload, _ := json.Marshal(map[string]string{
		"title":        title,
		"body":         body,
		"link":         link,
		"forum_domain": forumDomain,
	})

	var (
		sent           int32
		staleEndpoints []string
		mu             sync.Mutex
		wg             sync.WaitGroup
	)

	// Send push notifications concurrently (max 10 in parallel)
	sem := make(chan struct{}, 10)
	for _, s := range subs {
		wg.Add(1)
		go func(s sub) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			subscription := &webpush.Subscription{
				Endpoint: s.Endpoint,
				Keys: webpush.Keys{
					P256dh: s.P256dh,
					Auth:   s.Auth,
				},
			}

			resp, err := webpush.SendNotification(payload, subscription, &webpush.Options{
				Subscriber:      vapidSubject,
				VAPIDPublicKey:  vapidPublicKey,
				VAPIDPrivateKey: vapidPrivateKey,
			})
			if err != nil {
				return
			}
			resp.Body.Close()

			if resp.StatusCode == 410 || resp.StatusCode == 404 {
				mu.Lock()
				staleEndpoints = append(staleEndpoints, s.Endpoint)
				mu.Unlock()
			} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				atomic.AddInt32(&sent, 1)
			}
		}(s)
	}
	wg.Wait()

	// Batch cleanup stale endpoints
	if len(staleEndpoints) > 0 {
		pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = ANY($2)`, userID, staleEndpoints)
	}

	return int(sent)
}

// --- Helpers ---

type forumManifest struct {
	ForumlineVersion string   `json:"forumline_version"`
	Name             string   `json:"name"`
	Domain           string   `json:"domain"`
	IconURL          string   `json:"icon_url"`
	APIBase          string   `json:"api_base"`
	WebBase          string   `json:"web_base"`
	Capabilities     []string `json:"capabilities"`
}

func fetchForumManifest(domain string) (*forumManifest, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("https://%s/.well-known/forumline-manifest.json", domain))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest returned status %d", resp.StatusCode)
	}

	var manifest forumManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("failed to decode manifest: %w", err)
	}

	if manifest.Name == "" || manifest.APIBase == "" || manifest.WebBase == "" {
		return nil, fmt.Errorf("manifest missing required fields")
	}

	// Use the requested domain if manifest doesn't specify one
	if manifest.Domain == "" {
		manifest.Domain = domain
	}

	return &manifest, nil
}

func getForumIDByDomain(ctx context.Context, pool *pgxpool.Pool, domain string) string {
	var id string
	pool.QueryRow(ctx, `SELECT id FROM forumline_forums WHERE domain = $1`, domain).Scan(&id)
	return id
}

type profileInfo struct {
	Username    string
	DisplayName string
	AvatarURL   *string
}

func fetchProfilesByIDs(ctx context.Context, pool *pgxpool.Pool, ids []string) map[string]*profileInfo {
	profiles := make(map[string]*profileInfo)
	if len(ids) == 0 {
		return profiles
	}

	rows, err := pool.Query(ctx,
		`SELECT id, username, display_name, avatar_url FROM forumline_profiles WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return profiles
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		p := &profileInfo{}
		if err := rows.Scan(&id, &p.Username, &p.DisplayName, &p.AvatarURL); err != nil {
			continue
		}
		profiles[id] = p
	}

	return profiles
}

func stringOrEmpty(s *string) string {
	if s != nil {
		return *s
	}
	return ""
}

func trimString(s string) string {
	return strings.TrimSpace(s)
}

func bcryptHash(secret string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}
