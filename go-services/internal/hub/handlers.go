package hub

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/go-services/internal/shared"
)

// Handlers holds dependencies for all hub API handlers.
type Handlers struct {
	Pool   *pgxpool.Pool
	SSEHub *shared.SSEHub
}
