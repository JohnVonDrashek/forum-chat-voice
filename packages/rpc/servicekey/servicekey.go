// Package servicekey provides Connect RPC interceptors for internal service-to-service auth.
// Both the server (validates) and client (injects) use the same INTERNAL_SERVICE_KEY env var.
package servicekey

import (
	"context"
	"errors"

	"connectrpc.com/connect"
)

const header = "x-internal-service-key"

// NewServerInterceptor returns an interceptor that rejects requests missing the correct key.
func NewServerInterceptor(key string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if req.Header().Get(header) != key {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid service key"))
			}
			return next(ctx, req)
		}
	}
}

// NewClientInterceptor returns an interceptor that injects the service key into every request.
func NewClientInterceptor(key string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			req.Header().Set(header, key)
			return next(ctx, req)
		}
	}
}
