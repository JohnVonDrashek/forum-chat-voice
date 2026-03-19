package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/services/forumline-hub/sqlcdb"
)

type Membership struct {
	ForumDomain        string   `json:"forum_domain"`
	ForumName          string   `json:"forum_name"`
	ForumIconUrl       *string  `json:"forum_icon_url,omitempty"`
	ApiBase            string   `json:"api_base"`
	WebBase            string   `json:"web_base"`
	Capabilities       []string `json:"capabilities"`
	MemberCount        int      `json:"member_count"`
	JoinedAt           string   `json:"joined_at"`
	NotificationsMuted bool     `json:"notifications_muted"`
	ForumAuthedAt      *string  `json:"forum_authed_at,omitempty"`
}

func (s *Store) ListMemberships(ctx context.Context, userID string) ([]Membership, error) {
	rows, err := s.Q.ListMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}

	memberships := make([]Membership, 0, len(rows))
	for _, r := range rows {
		m := Membership{
			ForumDomain:        r.Domain,
			ForumName:          r.Name,
			ForumIconUrl:       r.IconUrl,
			ApiBase:            r.ApiBase,
			WebBase:            r.WebBase,
			Capabilities:       r.Capabilities,
			MemberCount:        int(r.MemberCount),
			JoinedAt:           r.JoinedAt.Format(time.RFC3339),
			NotificationsMuted: r.NotificationsMuted,
		}
		if r.ForumAuthedAt != nil {
			ts := r.ForumAuthedAt.Format(time.RFC3339)
			m.ForumAuthedAt = &ts
		}
		memberships = append(memberships, m)
	}
	if len(memberships) == 0 {
		memberships = []Membership{}
	}
	return memberships, nil
}

func (s *Store) UpsertMembership(ctx context.Context, userID string, forumID uuid.UUID) error {
	return s.Q.UpsertMembership(ctx, sqlcdb.UpsertMembershipParams{
		UserID:  userID,
		ForumID: forumID,
	})
}

func (s *Store) DeleteMembership(ctx context.Context, userID string, forumID uuid.UUID) error {
	return s.Q.DeleteMembership(ctx, sqlcdb.DeleteMembershipParams{
		UserID:  userID,
		ForumID: forumID,
	})
}

func (s *Store) UpdateMembershipAuth(ctx context.Context, userID string, forumID uuid.UUID, authed bool) error {
	if authed {
		return s.Q.SetMembershipAuthed(ctx, sqlcdb.SetMembershipAuthedParams{
			UserID:  userID,
			ForumID: forumID,
		})
	}
	return s.Q.ClearMembershipAuthed(ctx, sqlcdb.ClearMembershipAuthedParams{
		UserID:  userID,
		ForumID: forumID,
	})
}

func (s *Store) UpdateMembershipMute(ctx context.Context, userID string, forumID uuid.UUID, muted bool) error {
	return s.Q.UpdateMembershipMute(ctx, sqlcdb.UpdateMembershipMuteParams{
		NotificationsMuted: muted,
		UserID:             userID,
		ForumID:            forumID,
	})
}

func (s *Store) GetMembershipJoinDetails(ctx context.Context, forumID uuid.UUID, userID string) (map[string]interface{}, error) {
	r, err := s.Q.GetMembershipJoinDetails(ctx, sqlcdb.GetMembershipJoinDetailsParams{
		ID:     forumID,
		UserID: userID,
	})
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"domain": r.Domain, "name": r.Name, "icon_url": r.IconUrl,
		"api_base": r.ApiBase, "web_base": r.WebBase, "capabilities": r.Capabilities,
		"joined_at": r.JoinedAt.Format(time.RFC3339), "member_count": int(r.MemberCount),
	}, nil
}
