package service

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type VAPIDConfig struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

type PushService struct {
	Store *store.Store
	VAPID VAPIDConfig
}

func NewPushService(s *store.Store) *PushService {
	vapidEmail := os.Getenv("VAPID_EMAIL")
	vapidSubject := vapidEmail
	if vapidSubject != "" && !strings.HasPrefix(vapidSubject, "mailto:") {
		vapidSubject = "mailto:" + vapidSubject
	}

	ps := &PushService{
		Store: s,
		VAPID: VAPIDConfig{
			PublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
			PrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
			Subject:    vapidSubject,
		},
	}
	if ps.VAPID.PublicKey == "" || ps.VAPID.PrivateKey == "" {
		log.Println("[Push] WARNING: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set, push notifications disabled")
	}
	return ps
}

func (ps *PushService) SendToUser(ctx context.Context, userID, title, body, link, forumDomain string) int {
	if ps.VAPID.PublicKey == "" || ps.VAPID.PrivateKey == "" {
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
				Subscriber:      ps.VAPID.Subject,
				VAPIDPublicKey:  ps.VAPID.PublicKey,
				VAPIDPrivateKey: ps.VAPID.PrivateKey,
			})
			if err != nil {
				log.Printf("[push] send error to %s: %v", endpoint[:min(len(endpoint), 60)], err)
				return
			}
			_ = resp.Body.Close()

			if resp.StatusCode == 410 || resp.StatusCode == 404 {
				mu.Lock()
				staleEndpoints = append(staleEndpoints, endpoint)
				mu.Unlock()
			} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				atomic.AddInt32(&sent, 1)
			} else {
				log.Printf("[push] unexpected status %d for %s", resp.StatusCode, endpoint[:min(len(endpoint), 60)])
			}
		}(s.Endpoint, s.P256dh, s.Auth)
	}
	wg.Wait()

	if len(staleEndpoints) > 0 {
		log.Printf("[push] cleaning up %d stale endpoints for %s", len(staleEndpoints), userID)
		ps.Store.DeleteStaleEndpoints(ctx, userID, staleEndpoints)
	}

	return int(sent)
}
