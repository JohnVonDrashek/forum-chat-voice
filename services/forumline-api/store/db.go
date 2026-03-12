package store

import (
	shared "github.com/forumline/forumline/shared-go"
)

// Store wraps the database pool and provides domain-grouped query methods.
// Each domain file (profile.go, forum.go, etc.) adds methods to this struct.
type Store struct {
	Pool *shared.ObservablePool
}

func New(pool *shared.ObservablePool) *Store {
	return &Store{Pool: pool}
}
