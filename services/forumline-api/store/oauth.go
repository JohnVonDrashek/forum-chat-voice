package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type OAuthClientRow struct {
	ID               string
	ForumID          string
	ClientSecretHash string
	RedirectURIs     []string
}

type AuthCodeRow struct {
	ID          string
	UserID      string
	RedirectURI string
	ExpiresAt   time.Time
}

func (s *Store) GetOAuthClient(ctx context.Context, clientID string) (*OAuthClientRow, error) {
	var c OAuthClientRow
	err := s.Pool.QueryRow(ctx,
		`SELECT id, forum_id, redirect_uris FROM forumline_oauth_clients WHERE client_id = $1`, clientID,
	).Scan(&c.ID, &c.ForumID, &c.RedirectURIs)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) GetOAuthClientWithSecret(ctx context.Context, clientID string) (*OAuthClientRow, error) {
	var c OAuthClientRow
	err := s.Pool.QueryRow(ctx,
		`SELECT id, forum_id, client_secret_hash FROM forumline_oauth_clients WHERE client_id = $1`, clientID,
	).Scan(&c.ID, &c.ForumID, &c.ClientSecretHash)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) CreateAuthCode(ctx context.Context, code, userID, forumID, redirectURI string, expiresAt time.Time) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_auth_codes (code, user_id, forum_id, redirect_uri, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		code, userID, forumID, redirectURI, expiresAt,
	)
	return err
}

func (s *Store) ConsumeAuthCode(ctx context.Context, code, forumID string) (*AuthCodeRow, error) {
	var a AuthCodeRow
	var expiresAt time.Time
	err := s.Pool.QueryRow(ctx,
		`UPDATE forumline_auth_codes SET used = true
		 WHERE code = $1 AND forum_id = $2 AND used = false
		 RETURNING id, user_id, redirect_uri, expires_at`,
		code, forumID,
	).Scan(&a.ID, &a.UserID, &a.RedirectURI, &expiresAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.ExpiresAt = expiresAt
	return &a, nil
}

func (s *Store) OAuthClientExistsBySecretHash(ctx context.Context, secretHash string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM forumline_oauth_clients WHERE client_secret_hash = $1)`,
		secretHash,
	).Scan(&exists)
	return exists, err
}

func (s *Store) CreateOAuthClient(ctx context.Context, forumID, clientID, clientSecretHash string, redirectURIs []string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO forumline_oauth_clients (forum_id, client_id, client_secret_hash, redirect_uris)
		 VALUES ($1, $2, $3, $4)`,
		forumID, clientID, clientSecretHash, redirectURIs,
	)
	return err
}
