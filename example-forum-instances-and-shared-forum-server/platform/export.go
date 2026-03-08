package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ExportData is the portable format for a forum's data.
// It can be imported by a self-hosted forumline instance.
type ExportData struct {
	ForumlineVersion string    `json:"forumline_version"`
	ExportedAt       time.Time `json:"exported_at"`
	Forum            ForumMeta `json:"forum"`

	Categories              []json.RawMessage `json:"categories"`
	Profiles                []json.RawMessage `json:"profiles"`
	Threads                 []json.RawMessage `json:"threads"`
	Posts                   []json.RawMessage `json:"posts"`
	ChatChannels            []json.RawMessage `json:"chat_channels"`
	ChatMessages            []json.RawMessage `json:"chat_messages"`
	VoiceRooms              []json.RawMessage `json:"voice_rooms"`
	Bookmarks               []json.RawMessage `json:"bookmarks"`
	Notifications           []json.RawMessage `json:"notifications"`
	ChannelFollows          []json.RawMessage `json:"channel_follows"`
	NotificationPreferences []json.RawMessage `json:"notification_preferences"`
}

type ForumMeta struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Domain      string `json:"domain"`
	Description string `json:"description"`
}

// Export dumps all data from a tenant's schema into the portable ExportData format.
func Export(ctx context.Context, pool *pgxpool.Pool, tenant *Tenant) (*ExportData, error) {
	// Acquire a connection and set search_path to the tenant's schema
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	sanitized := pgx.Identifier{tenant.SchemaName}.Sanitize()
	_, err = conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", sanitized))
	if err != nil {
		return nil, fmt.Errorf("set search_path: %w", err)
	}

	data := &ExportData{
		ForumlineVersion: "1",
		ExportedAt:       time.Now().UTC(),
		Forum: ForumMeta{
			Slug:        tenant.Slug,
			Name:        tenant.Name,
			Domain:      tenant.Domain,
			Description: tenant.Description,
		},
	}

	// Export each table as JSON rows
	tables := []struct {
		name  string
		dest  *[]json.RawMessage
		query string
	}{
		{"categories", &data.Categories, "SELECT row_to_json(t) FROM categories t ORDER BY sort_order"},
		{"profiles", &data.Profiles, "SELECT row_to_json(t) FROM profiles t ORDER BY created_at"},
		{"threads", &data.Threads, "SELECT row_to_json(t) FROM threads t ORDER BY created_at"},
		{"posts", &data.Posts, "SELECT row_to_json(t) FROM posts t ORDER BY created_at"},
		{"chat_channels", &data.ChatChannels, "SELECT row_to_json(t) FROM chat_channels t ORDER BY created_at"},
		{"chat_messages", &data.ChatMessages, "SELECT row_to_json(t) FROM chat_messages t ORDER BY created_at"},
		{"voice_rooms", &data.VoiceRooms, "SELECT row_to_json(t) FROM voice_rooms t ORDER BY created_at"},
		{"bookmarks", &data.Bookmarks, "SELECT row_to_json(t) FROM bookmarks t ORDER BY created_at"},
		{"notifications", &data.Notifications, "SELECT row_to_json(t) FROM notifications t ORDER BY created_at"},
		{"channel_follows", &data.ChannelFollows, "SELECT row_to_json(t) FROM channel_follows t ORDER BY created_at"},
		{"notification_preferences", &data.NotificationPreferences, "SELECT row_to_json(t) FROM notification_preferences t ORDER BY updated_at"},
	}

	for _, table := range tables {
		rows, err := conn.Query(ctx, table.query)
		if err != nil {
			return nil, fmt.Errorf("export %s: %w", table.name, err)
		}

		var items []json.RawMessage
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan %s: %w", table.name, err)
			}
			items = append(items, json.RawMessage(raw))
		}
		rows.Close()

		if items == nil {
			items = []json.RawMessage{}
		}
		*table.dest = items
	}

	return data, nil
}
