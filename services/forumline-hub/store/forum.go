package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/services/forumline-hub/sqlcdb"
	"github.com/jackc/pgx/v5"
)

type ForumManifest struct {
	ForumlineVersion string   `json:"forumline_version"`
	Name             string   `json:"name"`
	Domain           string   `json:"domain"`
	IconURL          string   `json:"icon_url"`
	APIBase          string   `json:"api_base"`
	WebBase          string   `json:"web_base"`
	Capabilities     []string `json:"capabilities"`
	Tags             []string `json:"tags"`
}

// ListForums uses dynamic SQL (search, tag, sort) — stays hand-written.
func (s *Store) ListForums(ctx context.Context, search, tag, sort string, limit, offset int) ([]map[string]interface{}, error) {
	query := `SELECT id, domain, name, icon_url, api_base, web_base, capabilities, description, screenshot_url, tags, member_count
		 FROM forumline_forums WHERE approved = true AND array_length(capabilities, 1) > 0`
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
		var id uuid.UUID
		var domain, name, apiBase, webBase string
		var iconURL, description, screenshotURL *string
		var capabilities, forumTags []string
		var memberCount int
		if err := rows.Scan(&id, &domain, &name, &iconURL, &apiBase, &webBase, &capabilities, &description, &screenshotURL, &forumTags, &memberCount); err != nil {
			continue
		}
		forums = append(forums, map[string]interface{}{
			"id": id.String(), "domain": domain, "name": name, "icon_url": iconURL,
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
	items, err := s.Q.ListForumTags(ctx)
	if err != nil {
		return nil, err
	}
	tags := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			tags = append(tags, s)
		}
	}
	if len(tags) == 0 {
		tags = []string{}
	}
	return tags, nil
}

func (s *Store) ListRecommendedForums(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	rows, err := s.Q.ListRecommendedForums(ctx, userID)
	if err != nil {
		return nil, err
	}

	forums := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		forums = append(forums, map[string]interface{}{
			"id": r.ID.String(), "domain": r.Domain, "name": r.Name, "icon_url": r.IconUrl,
			"api_base": r.ApiBase, "web_base": r.WebBase, "capabilities": r.Capabilities,
			"description": r.Description, "screenshot_url": r.ScreenshotUrl,
			"tags": r.Tags, "member_count": int(r.MemberCount), "shared_member_count": int(r.SharedMemberCount),
		})
	}
	if len(forums) == 0 {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) GetForumIDByDomain(ctx context.Context, domain string) uuid.UUID {
	id, err := s.Q.GetForumIDByDomain(ctx, domain)
	if err != nil {
		return uuid.UUID{}
	}
	return id
}

func (s *Store) GetForumDomainByID(ctx context.Context, forumID uuid.UUID) (string, error) {
	return s.Q.GetForumDomainByID(ctx, forumID)
}

func (s *Store) GetForumName(ctx context.Context, forumID uuid.UUID) string {
	name, err := s.Q.GetForumName(ctx, forumID)
	if err != nil {
		return ""
	}
	return name
}

func (s *Store) RegisterForum(ctx context.Context, domain, name, apiBase, webBase string,
	capabilities []string, description *string, tags []string, ownerID string) (uuid.UUID, error) {
	id, err := s.Q.RegisterForum(ctx, sqlcdb.RegisterForumParams{
		Domain: domain, Name: name, ApiBase: apiBase, WebBase: webBase,
		Capabilities: capabilities, Description: description,
		Tags: tags, OwnerID: &ownerID,
	})
	if err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
}

func (s *Store) UpsertForumFromManifest(ctx context.Context, m *ForumManifest, tags []string) (uuid.UUID, error) {
	id, err := s.Q.UpsertForumFromManifest(ctx, sqlcdb.UpsertForumFromManifestParams{
		Domain: m.Domain, Name: m.Name, IconUrl: &m.IconURL,
		ApiBase: m.APIBase, WebBase: m.WebBase, Capabilities: m.Capabilities, Tags: tags,
	})
	if err == pgx.ErrNoRows {
		return uuid.UUID{}, nil
	}
	if err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
}

func (s *Store) CountForumsByOwner(ctx context.Context, ownerID string) (int, error) {
	count, err := s.Q.CountForumsByOwner(ctx, &ownerID)
	return int(count), err
}

func (s *Store) DomainExists(ctx context.Context, domain string) (bool, error) {
	return s.Q.DomainExists(ctx, domain)
}

func (s *Store) ListOwnedForums(ctx context.Context, ownerID string) ([]map[string]interface{}, error) {
	rows, err := s.Q.ListOwnedForums(ctx, &ownerID)
	if err != nil {
		return nil, err
	}

	forums := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		forum := map[string]interface{}{
			"id": r.ID.String(), "domain": r.Domain, "name": r.Name, "icon_url": r.IconUrl,
			"api_base": r.ApiBase, "web_base": r.WebBase, "approved": r.Approved,
			"member_count": int(r.MemberCount), "consecutive_failures": int(r.ConsecutiveFailures),
			"created_at": r.CreatedAt.Format(time.RFC3339),
		}
		if r.LastSeenAt != nil {
			forum["last_seen_at"] = r.LastSeenAt.Format(time.RFC3339)
		}
		forums = append(forums, forum)
	}
	if len(forums) == 0 {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) GetForumOwner(ctx context.Context, forumID uuid.UUID) (*string, error) {
	owner, err := s.Q.GetForumOwner(ctx, forumID)
	if err != nil {
		return nil, err
	}
	return owner, nil
}

func (s *Store) DeleteForum(ctx context.Context, forumID uuid.UUID, ownerID string) (int64, error) {
	return s.Q.DeleteForum(ctx, sqlcdb.DeleteForumParams{
		ID:      forumID,
		OwnerID: &ownerID,
	})
}

func (s *Store) CountForumMembers(ctx context.Context, forumID uuid.UUID) int {
	count, err := s.Q.CountForumMembers(ctx, forumID)
	if err != nil {
		return 0
	}
	return int(count)
}

func (s *Store) UpdateForumScreenshot(ctx context.Context, domain, screenshotURL string) (int64, error) {
	return s.Q.UpdateForumScreenshot(ctx, sqlcdb.UpdateForumScreenshotParams{
		ScreenshotUrl: &screenshotURL,
		Domain:        domain,
	})
}

func (s *Store) UpdateForumIcon(ctx context.Context, domain, iconURL string) (int64, error) {
	return s.Q.UpdateForumIcon(ctx, sqlcdb.UpdateForumIconParams{
		IconUrl: &iconURL,
		Domain:  domain,
	})
}

func (s *Store) MarkForumHealthy(ctx context.Context, domain string) (int64, error) {
	affected, err := s.Q.MarkForumHealthy(ctx, domain)
	if err != nil {
		return 0, err
	}
	if affected > 0 {
		_ = s.Q.ReapproveHealthyForum(ctx, domain)
	}
	return affected, nil
}

func (s *Store) IncrementForumFailures(ctx context.Context, domain string) (int, *string, error) {
	row, err := s.Q.IncrementForumFailures(ctx, domain)
	if err == pgx.ErrNoRows {
		return 0, nil, fmt.Errorf("forum not found")
	}
	if err != nil {
		return 0, nil, err
	}
	return int(row.ConsecutiveFailures), row.OwnerID, nil
}

func (s *Store) DelistForum(ctx context.Context, domain string) int64 {
	n, _ := s.Q.DelistForum(ctx, domain)
	return n
}

func (s *Store) AutoDeleteUnownedForum(ctx context.Context, domain string) int64 {
	n, _ := s.Q.AutoDeleteUnownedForum(ctx, domain)
	return n
}

func (s *Store) ListAllForums(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.Q.ListAllForums(ctx)
	if err != nil {
		return nil, err
	}

	forums := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		forum := map[string]interface{}{
			"id": r.ID.String(), "domain": r.Domain, "name": r.Name, "icon_url": r.IconUrl,
			"api_base": r.ApiBase, "web_base": r.WebBase, "capabilities": r.Capabilities,
			"approved": r.Approved, "has_owner": r.OwnerID != nil,
			"consecutive_failures": int(r.ConsecutiveFailures),
		}
		if r.LastSeenAt != nil {
			forum["last_seen_at"] = r.LastSeenAt.Format(time.RFC3339)
		}
		forums = append(forums, forum)
	}
	if len(forums) == 0 {
		forums = []map[string]interface{}{}
	}
	return forums, nil
}

func (s *Store) GetForumNameByDomain(ctx context.Context, domain string) (string, error) {
	return s.Q.GetForumNameByDomain(ctx, domain)
}
