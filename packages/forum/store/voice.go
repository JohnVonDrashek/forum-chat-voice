package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/forum/oapi"
	"github.com/forumline/forumline/forum/sqlcdb"
)

// ListVoiceRooms returns all voice rooms ordered by name.
func (s *Store) ListVoiceRooms(ctx context.Context) ([]oapi.VoiceRoom, error) {
	rows, err := s.Q.ListVoiceRooms(ctx)
	if err != nil {
		return nil, err
	}
	rooms := make([]oapi.VoiceRoom, 0, len(rows))
	for _, r := range rows {
		rooms = append(rooms, oapi.VoiceRoom{
			Id:        r.ID,
			Name:      r.Name,
			Slug:      r.Slug,
			CreatedAt: r.CreatedAt,
		})
	}
	return rooms, nil
}

// ListVoicePresence returns all voice presence entries with profile.
func (s *Store) ListVoicePresence(ctx context.Context) ([]oapi.VoicePresence, error) {
	rows, err := s.Q.ListVoicePresence(ctx)
	if err != nil {
		return nil, err
	}
	presence := make([]oapi.VoicePresence, 0, len(rows))
	for _, r := range rows {
		presence = append(presence, voicePresenceRowToOapi(r))
	}
	return presence, nil
}

// SetVoicePresence sets a user's voice presence.
func (s *Store) SetVoicePresence(ctx context.Context, userID uuid.UUID, roomSlug string) error {
	now := time.Now()
	return s.Q.SetVoicePresence(ctx, sqlcdb.SetVoicePresenceParams{
		UserID:   userID,
		RoomSlug: roomSlug,
		JoinedAt: now,
	})
}

// ClearVoicePresence removes a user's voice presence and returns the room slug.
func (s *Store) ClearVoicePresence(ctx context.Context, userID uuid.UUID) (string, error) {
	return s.Q.ClearVoicePresence(ctx, userID)
}
