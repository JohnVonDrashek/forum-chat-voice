package service

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"sync/atomic"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type PushService struct {
	Store *store.Store
}

func NewPushService(s *store.Store) *PushService {
	return &PushService{Store: s}
}

// SendToUser sends push notifications to all of a user's subscriptions.
// Returns the number of successfully sent notifications.
func (ps *PushService) SendToUser(ctx context.Context, userID, title, body, link, forumDomain string) int {
	vapidPublicKey := os.Getenv("VAPID_PUBLIC_KEY")
	vapidPrivateKey := os.Getenv("VAPID_PRIVATE_KEY")
	vapidSubject := os.Getenv("VAPID_SUBJECT")

	if vapidPublicKey == "" || vapidPrivateKey == "" {
		return 0
	}

	subs, err := ps.Store.ListPushSubscriptions(ctx, userID)
	if err != nil || len(subs) == 0 {
		return 0
	}

	payload, _ := json.Marshal(map[string]string{
		"title":        title,
		"body":         body,
		"link":         link,
		"forum_domain": forumDomain,
	})

	var (
		sent           int32
		staleEndpoints []string
		mu             sync.Mutex
		wg             sync.WaitGroup
	)

	sem := make(chan struct{}, 10)
	for _, s := range subs {
		wg.Add(1)
		go func(endpoint, p256dh, auth string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			subscription := &webpush.Subscription{
				Endpoint: endpoint,
				Keys: webpush.Keys{
					P256dh: p256dh,
					Auth:   auth,
				},
			}

			resp, err := webpush.SendNotification(payload, subscription, &webpush.Options{
				Subscriber:      vapidSubject,
				VAPIDPublicKey:  vapidPublicKey,
				VAPIDPrivateKey: vapidPrivateKey,
			})
			if err != nil {
				return
			}
			_ = resp.Body.Close()

			if resp.StatusCode == 410 || resp.StatusCode == 404 {
				mu.Lock()
				staleEndpoints = append(staleEndpoints, endpoint)
				mu.Unlock()
			} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				atomic.AddInt32(&sent, 1)
			}
		}(s.Endpoint, s.P256dh, s.Auth)
	}
	wg.Wait()

	if len(staleEndpoints) > 0 {
		ps.Store.DeleteStaleEndpoints(ctx, userID, staleEndpoints)
	}

	return int(sent)
}
