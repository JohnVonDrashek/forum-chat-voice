//go:generate sqlc generate -f ../sqlc.yaml
package store

import (
	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/services/forumline-hub/sqlcdb"
)

type Store struct {
	Pool *db.ObservablePool
	Q    *sqlcdb.Queries
}

func New(pool *db.ObservablePool) *Store {
	return &Store{
		Pool: pool,
		Q:    sqlcdb.New(pool),
	}
}
