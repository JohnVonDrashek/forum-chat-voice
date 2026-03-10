package platform

import (
	"context"

	"github.com/forumline/forum-server/forum"
	shared "github.com/forumline/forumline/shared-go"
)

// Import loads ExportData into a forum database.
// This is a thin wrapper around forum.Import for backwards compatibility.
func Import(ctx context.Context, db shared.DB, data *forum.ExportData) error {
	return forum.Import(ctx, db, data)
}
