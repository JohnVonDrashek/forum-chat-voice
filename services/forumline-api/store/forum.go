package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListForums(ctx context.Context, search, tag, sort string, limit, offset int) ([]map[string]interface{}, error) {
	query := `SELECT id, domain, name, icon_url, api_base, web_base, capabilities, description, screenshot_url, tags, member_count
		 FROM forumline_forums WHERE approved = true`
	var args []interface{}
	argIdx := 1

	if search != "" {
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
		query += fmt.Sprintf(` AND (name ILIKE $%d OR description ILIKE $%d OR domain ILIKE $%d)`, argIdx, argIdx, argIdx)
		args = append(args, "%"+escaped+"%")
		argIdx++
	}
	if tag != "" {
		query += fmt.Sprintf(` AND $%d = ANY(tags)`, argIdx)
		args = append(args, tag)
		argIdx++
	}

	switch sort {
	case "recent":
		query += ` ORDER BY created_at DESC`
	case "name":
		query += ` ORDER BY name`
	default:
		query += ` ORDER BY member_count DESC, name`
	}

	query += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var forums []map[string]interface{}
	for rows.Next() {
		var id, domain, name, apiBase, webBase string
		var iconURL, description, screenshotURL *string
		var capabilities, forumTags []string
		var memberCount int
		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase, &capabilities, &description, &screenshotURL, &forumTags, &memberCount); err != nil {
			continue
		}
		forums = append(forums, map[string]interface{}{
			"id": id, "domain": domain, "name": name, "icon_url": iconURL,
			"api_base": apiBase, "web_base": webBase, "capabilities": capabilities,
			"description": description, "screenshot_url": screenshotURL,
			"tags": forumTags, "member_count": memberCount,
		})
	}
	if forums == nil {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) ListForumTags(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT DISTINCT unnest(tags) AS tag FROM forumline_forums WHERE approved = true ORDER BY tag`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			continue
		}
		tags = append(tags, tag)
	}
	if tags == nil {
		tags = []string{}
	}
	return tags, nil
}

func (s *Store) ListRecommendedForums(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	rows, err := s.Pool.Query(ctx,
		`WITH my_forums AS (
			SELECT forum_id FROM forumline_memberships WHERE user_id = $1
		),
		forum_mates AS (
			SELECT DISTINCT m.user_id
			FROM forumline_memberships m
			JOIN my_forums mf ON m.forum_id = mf.forum_id
			WHERE m.user_id != $1
		)
		SELECT f.id, f.domain, f.name, f.icon_url, f.api_base, f.web_base,
		       f.capabilities, f.description, f.screenshot_url, f.tags, f.member_count,
		       COUNT(m2.user_id) AS shared_member_count
		FROM forumline_memberships m2
		JOIN forum_mates fm ON m2.user_id = fm.user_id
		JOIN forumline_forums f ON f.id = m2.forum_id
		WHERE f.approved = true
		  AND f.id NOT IN (SELECT forum_id FROM my_forums)
		GROUP BY f.id
		ORDER BY shared_member_count DESC, f.member_count DESC
		LIMIT 10`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var forums []map[string]interface{}
	for rows.Next() {
		var id, domain, name, apiBase, webBase string
		var iconURL, description, screenshotURL *string
		var capabilities, forumTags []string
		var memberCount, sharedMemberCount int
		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase,
			&capabilities, &description, &screenshotURL, &forumTags, &memberCount, &sharedMemberCount); err != nil {
			continue
		}
		forums = append(forums, map[string]interface{}{
			"id": id, "domain": domain, "name": name, "icon_url": iconURL,
			"api_base": apiBase, "web_base": webBase, "capabilities": capabilities,
			"description": description, "screenshot_url": screenshotURL,
			"tags": forumTags, "member_count": memberCount, "shared_member_count": sharedMemberCount,
		})
	}
	if forums == nil {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) GetForumIDByDomain(ctx context.Context, domain string) string {
	var id string
	_ = s.Pool.QueryRow(ctx, `SELECT id FROM forumline_forums WHERE domain = $1`, domain).Scan(&id)
	return id
}

func (s *Store) GetForumName(ctx context.Context, forumID string) string {
	var name string
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(name, domain) FROM forumline_forums WHERE id = $1`, forumID).Scan(&name)
	return name
}

func (s *Store) RegisterForum(ctx context.Context, domain, name, apiBase, webBase string,
	capabilities []string, description *string, tags []string, ownerID string) (string, error) {
	var forumID string
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO forumline_forums (domain, name, api_base, web_base, capabilities, description, tags, owner_id, approved)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
		 RETURNING id`,
		domain, name, apiBase, webBase, capabilities, description, tags, ownerID,
	).Scan(&forumID)
	return forumID, err
}

func (s *Store) UpsertForumFromManifest(ctx context.Context, m *model.ForumManifest, tags []string) (string, error) {
	var forumID string
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO forumline_forums (domain, name, icon_url, api_base, web_base, capabilities, tags, approved)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, false)
		 ON CONFLICT (domain) DO UPDATE SET
		   name = EXCLUDED.name, icon_url = EXCLUDED.icon_url,
		   api_base = EXCLUDED.api_base, web_base = EXCLUDED.web_base,
		   capabilities = EXCLUDED.capabilities, tags = EXCLUDED.tags
		 WHERE forumline_forums.approved = false
		 RETURNING id`,
		m.Domain, m.Name, m.IconURL, m.APIBase, m.WebBase, m.Capabilities, tags,
	).Scan(&forumID)
	if err == pgx.ErrNoRows {
		return "", nil // approved forum exists, don't overwrite
	}
	return forumID, err
}

func (s *Store) CountForumsByOwner(ctx context.Context, ownerID string) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM forumline_forums WHERE owner_id = $1`, ownerID).Scan(&count)
	return count, err
}

func (s *Store) DomainExists(ctx context.Context, domain string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM forumline_forums WHERE domain = $1)`, domain).Scan(&exists)
	return exists, err
}

func (s *Store) ListOwnedForums(ctx context.Context, ownerID string) ([]map[string]interface{}, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT id, domain, name, icon_url, api_base, web_base, approved,
		        member_count, last_seen_at, consecutive_failures, created_at
		 FROM forumline_forums WHERE owner_id = $1
		 ORDER BY created_at DESC`, ownerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var forums []map[string]interface{}
	for rows.Next() {
		var id, domain, name, apiBase, webBase string
		var iconURL *string
		var approved bool
		var memberCount, consecutiveFailures int
		var lastSeenAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase, &approved,
			&memberCount, &lastSeenAt, &consecutiveFailures, &createdAt); err != nil {
			continue
		}
		forum := map[string]interface{}{
			"id": id, "domain": domain, "name": name, "icon_url": iconURL,
			"api_base": apiBase, "web_base": webBase, "approved": approved,
			"member_count": memberCount, "consecutive_failures": consecutiveFailures,
			"created_at": createdAt.Format(time.RFC3339),
		}
		if lastSeenAt != nil {
			forum["last_seen_at"] = lastSeenAt.Format(time.RFC3339)
		}
		forums = append(forums, forum)
	}
	if forums == nil {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) GetForumOwner(ctx context.Context, forumID string) (*string, error) {
	var ownerID *string
	err := s.Pool.QueryRow(ctx, `SELECT owner_id FROM forumline_forums WHERE id = $1`, forumID).Scan(&ownerID)
	return ownerID, err
}

func (s *Store) DeleteForum(ctx context.Context, forumID, ownerID string) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM forumline_forums WHERE id = $1 AND owner_id = $2`, forumID, ownerID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Store) DeleteForumByID(ctx context.Context, forumID string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM forumline_forums WHERE id = $1`, forumID)
	return err
}

func (s *Store) CountForumMembers(ctx context.Context, forumID string) int {
	var count int
	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM forumline_memberships WHERE forum_id = $1`, forumID).Scan(&count)
	return count
}

func (s *Store) UpdateForumScreenshot(ctx context.Context, domain, screenshotURL string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE forumline_forums SET screenshot_url = $1, updated_at = now() WHERE domain = $2`,
		screenshotURL, domain)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Store) UpdateForumIcon(ctx context.Context, domain, iconURL string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE forumline_forums SET icon_url = $1, updated_at = now() WHERE domain = $2`,
		iconURL, domain)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Store) MarkForumHealthy(ctx context.Context, domain string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE forumline_forums SET last_seen_at = now(), consecutive_failures = 0 WHERE domain = $1`, domain)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() > 0 {
		// Re-approve owned forums that have been healthy
		_, _ = s.Pool.Exec(ctx,
			`UPDATE forumline_forums SET approved = true WHERE domain = $1 AND approved = false AND consecutive_failures = 0 AND owner_id IS NOT NULL`,
			domain,
		)
	}
	return tag.RowsAffected(), nil
}

func (s *Store) IncrementForumFailures(ctx context.Context, domain string) (int, *string, error) {
	var failures int
	var ownerID *string
	err := s.Pool.QueryRow(ctx,
		`UPDATE forumline_forums SET consecutive_failures = consecutive_failures + 1
		 WHERE domain = $1 RETURNING consecutive_failures, owner_id`, domain,
	).Scan(&failures, &ownerID)
	if err == pgx.ErrNoRows {
		return 0, nil, fmt.Errorf("forum not found")
	}
	return failures, ownerID, err
}

func (s *Store) DelistForum(ctx context.Context, domain string) int64 {
	tag, _ := s.Pool.Exec(ctx,
		`UPDATE forumline_forums SET approved = false WHERE domain = $1 AND approved = true`, domain)
	return tag.RowsAffected()
}

func (s *Store) AutoDeleteUnownedForum(ctx context.Context, domain string) int64 {
	tag, _ := s.Pool.Exec(ctx,
		`DELETE FROM forumline_forums WHERE domain = $1 AND owner_id IS NULL`, domain)
	return tag.RowsAffected()
}

func (s *Store) ListAllForums(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT id, domain, name, icon_url, api_base, web_base, capabilities, approved, owner_id,
		        last_seen_at, consecutive_failures
		 FROM forumline_forums ORDER BY domain`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var forums []map[string]interface{}
	for rows.Next() {
		var id, domain, name, apiBase, webBase string
		var iconURL, ownerID *string
		var capabilities []string
		var approved bool
		var lastSeenAt *time.Time
		var consecutiveFailures int
		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase,
			&capabilities, &approved, &ownerID, &lastSeenAt, &consecutiveFailures); err != nil {
			continue
		}
		forum := map[string]interface{}{
			"id": id, "domain": domain, "name": name, "icon_url": iconURL,
			"api_base": apiBase, "web_base": webBase, "capabilities": capabilities,
			"approved": approved, "has_owner": ownerID != nil,
			"consecutive_failures": consecutiveFailures,
		}
		if lastSeenAt != nil {
			forum["last_seen_at"] = lastSeenAt.Format(time.RFC3339)
		}
		forums = append(forums, forum)
	}
	if forums == nil {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}
