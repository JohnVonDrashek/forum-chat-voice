package store

import (
	"context"

	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
)

type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

func (s *Store) UpsertPushSubscription(ctx context.Context, userID, endpoint, p256dh, auth string) error {
	return s.Q.UpsertPushSubscription(ctx, sqlcdb.UpsertPushSubscriptionParams{
		UserID:   userID,
		Endpoint: endpoint,
		P256dh:   p256dh,
		Auth:     auth,
	})
}

func (s *Store) DeletePushSubscription(ctx context.Context, userID, endpoint string) error {
	return s.Q.DeletePushSubscription(ctx, sqlcdb.DeletePushSubscriptionParams{
		UserID:   userID,
		Endpoint: endpoint,
	})
}

func (s *Store) ListPushSubscriptions(ctx context.Context, userID string) ([]PushSubscription, error) {
	rows, err := s.Q.ListPushSubscriptions(ctx, userID)
	if err != nil {
		return nil, err
	}
	subs := make([]PushSubscription, len(rows))
	for i, r := range rows {
		subs[i] = PushSubscription{
			Endpoint: r.Endpoint,
			P256dh:   r.P256dh,
			Auth:     r.Auth,
		}
	}
	return subs, nil
}

func (s *Store) DeleteStaleEndpoints(ctx context.Context, userID string, endpoints []string) {
	if len(endpoints) == 0 {
		return
	}
	_ = s.Q.DeleteStaleEndpoints(ctx, sqlcdb.DeleteStaleEndpointsParams{
		UserID:    userID,
		Endpoints: endpoints,
	})
}
