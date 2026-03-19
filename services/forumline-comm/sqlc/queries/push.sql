-- name: UpsertPushSubscription :exec
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2;

-- name: ListPushSubscriptions :many
SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1;

-- name: DeleteStaleEndpoints :exec
DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = ANY(@endpoints::text[]);
