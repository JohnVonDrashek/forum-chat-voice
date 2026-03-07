package forumline

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
)

// Handlers holds dependencies for all forumline API handlers.
type Handlers struct {
	Pool   *pgxpool.Pool
	SSEHub *shared.SSEHub
}
