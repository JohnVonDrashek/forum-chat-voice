package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/shared"
)

// Import loads ExportData into a forum database.
// For self-hosted instances, this operates on the default schema (public).
// For hosted instances, call with a TenantPool that has search_path set.
//
// Import is additive — it uses ON CONFLICT DO NOTHING to avoid duplicating
// data if run multiple times. It preserves original UUIDs and timestamps.
func Import(ctx context.Context, db shared.DB, data *ExportData) error {
	// Import order matters due to foreign keys:
	// 1. categories, chat_channels, voice_rooms (no deps)
	// 2. profiles (no deps)
	// 3. threads (depends on categories, profiles)
	// 4. posts (depends on threads, profiles)
	// 5. chat_messages (depends on chat_channels, profiles)
	// 6. bookmarks, notifications, channel_follows, notification_preferences (depend on profiles)

	steps := []struct {
		name  string
		items []json.RawMessage
		query string
	}{
		{"categories", data.Categories, `
			INSERT INTO categories (id, name, slug, description, sort_order, created_at)
			SELECT id, name, slug, description, sort_order, created_at
			FROM json_populate_record(null::categories, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"chat_channels", data.ChatChannels, `
			INSERT INTO chat_channels (id, name, slug, description, created_at)
			SELECT id, name, slug, description, created_at
			FROM json_populate_record(null::chat_channels, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"voice_rooms", data.VoiceRooms, `
			INSERT INTO voice_rooms (id, name, slug, created_at)
			SELECT id, name, slug, created_at
			FROM json_populate_record(null::voice_rooms, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"profiles", data.Profiles, `
			INSERT INTO profiles (id, username, display_name, avatar_url, bio, website, is_admin, forumline_id, created_at, updated_at)
			SELECT id, username, display_name, avatar_url, bio, website, is_admin, forumline_id, created_at, updated_at
			FROM json_populate_record(null::profiles, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"threads", data.Threads, `
			INSERT INTO threads (id, category_id, author_id, title, slug, content, image_url, is_pinned, is_locked, view_count, post_count, last_post_at, created_at, updated_at)
			SELECT id, category_id, author_id, title, slug, content, image_url, is_pinned, is_locked, view_count, post_count, last_post_at, created_at, updated_at
			FROM json_populate_record(null::threads, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"posts", data.Posts, `
			INSERT INTO posts (id, thread_id, author_id, content, reply_to_id, created_at, updated_at)
			SELECT id, thread_id, author_id, content, reply_to_id, created_at, updated_at
			FROM json_populate_record(null::posts, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"chat_messages", data.ChatMessages, `
			INSERT INTO chat_messages (id, channel_id, author_id, content, created_at)
			SELECT id, channel_id, author_id, content, created_at
			FROM json_populate_record(null::chat_messages, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"bookmarks", data.Bookmarks, `
			INSERT INTO bookmarks (id, user_id, thread_id, created_at)
			SELECT id, user_id, thread_id, created_at
			FROM json_populate_record(null::bookmarks, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"notifications", data.Notifications, `
			INSERT INTO notifications (id, user_id, type, title, message, link, read, created_at)
			SELECT id, user_id, type, title, message, link, read, created_at
			FROM json_populate_record(null::notifications, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"channel_follows", data.ChannelFollows, `
			INSERT INTO channel_follows (id, user_id, category_id, created_at)
			SELECT id, user_id, category_id, created_at
			FROM json_populate_record(null::channel_follows, $1::json)
			ON CONFLICT (id) DO NOTHING`},
		{"notification_preferences", data.NotificationPreferences, `
			INSERT INTO notification_preferences (id, user_id, category, enabled, updated_at)
			SELECT id, user_id, category, enabled, updated_at
			FROM json_populate_record(null::notification_preferences, $1::json)
			ON CONFLICT (id) DO NOTHING`},
	}

	for _, step := range steps {
		for i, item := range step.items {
			_, err := db.Exec(ctx, step.query, string(item))
			if err != nil {
				return fmt.Errorf("import %s row %d: %w", step.name, i, err)
			}
		}
		log.Printf("imported %d %s", len(step.items), step.name)
	}

	return nil
}
