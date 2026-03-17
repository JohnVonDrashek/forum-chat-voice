package db_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	backenddb "github.com/forumline/forumline/backend/db"
	localdb "github.com/forumline/forumline/services/forumline-api/db"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMigrations(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set, skipping migration test")
	}

	ctx := context.Background()

	// Run migrations
	if err := backenddb.RunMigrations(ctx, dsn, localdb.Migrations); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	// Verify goose_db_version table exists and has our baseline
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	var version int64
	err = db.QueryRowContext(ctx, "SELECT max(version_id) FROM goose_db_version").Scan(&version)
	if err != nil {
		t.Fatalf("query goose version: %v", err)
	}
	if version != 1 {
		t.Errorf("expected goose version 1 (baseline), got %d", version)
	}
	t.Logf("goose version: %d", version)

	// Verify key tables were created
	tables := []string{
		"forumline_profiles",
		"forumline_forums",
		"forumline_memberships",
		"forumline_conversations",
		"forumline_conversation_members",
		"forumline_calls",
		"forumline_direct_messages",
		"forumline_notifications",
		"push_subscriptions",
	}
	for _, table := range tables {
		var exists bool
		err := db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)",
			table,
		).Scan(&exists)
		if err != nil {
			t.Errorf("check table %s: %v", table, err)
		}
		if !exists {
			t.Errorf("table %s was not created", table)
		}
	}

	// Verify triggers exist
	triggers := []string{
		"update_forum_member_count_trigger",
		"forumline_profiles_updated_at",
		"dm_changes_notify",
		"push_dm_notify",
		"trg_forumline_notification_insert",
	}
	for _, trigger := range triggers {
		var exists bool
		err := db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name=$1)",
			trigger,
		).Scan(&exists)
		if err != nil {
			t.Errorf("check trigger %s: %v", trigger, err)
		}
		if !exists {
			t.Errorf("trigger %s was not created", trigger)
		}
	}

	// Run migrations again — should be idempotent
	if err := backenddb.RunMigrations(ctx, dsn, localdb.Migrations); err != nil {
		t.Fatalf("second RunMigrations failed (not idempotent): %v", err)
	}
	t.Log("idempotency check passed")
}
