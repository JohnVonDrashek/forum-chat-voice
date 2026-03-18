// Package metrics provides Prometheus HTTP instrumentation for Forumline services.
//
// Usage:
//
//	mux.Handle("GET /metrics", metrics.Handler())
//	handler = metrics.Middleware("forumline_api")(handler)
package metrics

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Handler returns the Prometheus metrics HTTP handler.
func Handler() http.Handler {
	return promhttp.Handler()
}

// Middleware returns HTTP middleware that records request duration, total
// count, and in-flight gauge. The namespace prefixes all metric names
// (e.g. "forumline_api_http_requests_total").
func Middleware(namespace string) func(http.Handler) http.Handler {
	requestDuration := promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: namespace,
		Name:      "http_request_duration_seconds",
		Help:      "HTTP request duration in seconds.",
		Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	}, []string{"method", "path", "status"})

	requestsTotal := promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: namespace,
		Name:      "http_requests_total",
		Help:      "Total HTTP requests.",
	}, []string{"method", "path", "status"})

	inFlight := promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: namespace,
		Name:      "http_requests_in_flight",
		Help:      "Number of HTTP requests currently being served.",
	})

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip metrics endpoint itself to avoid recursion.
			if r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}

			inFlight.Inc()
			defer inFlight.Dec()

			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()

			next.ServeHTTP(rw, r)

			duration := time.Since(start).Seconds()
			p := normalizePath(r.URL.Path)
			status := strconv.Itoa(rw.status)

			requestDuration.WithLabelValues(r.Method, p, status).Observe(duration)
			requestsTotal.WithLabelValues(r.Method, p, status).Inc()
		})
	}
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.wroteHeader {
		rw.status = code
		rw.wroteHeader = true
	}
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHeader {
		rw.wroteHeader = true
	}
	return rw.ResponseWriter.Write(b)
}

// Flush implements http.Flusher so SSE streams work through this middleware.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap supports http.ResponseController (Go 1.20+).
func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

// normalizePath reduces URL path cardinality by replacing dynamic segments
// (UUIDs, numeric IDs) with placeholders. This prevents metric explosion
// from per-resource paths like /api/threads/550e8400-e29b-41d4-a716-446655440000.
func normalizePath(p string) string {
	// Static files and assets — collapse to single label.
	if strings.HasPrefix(p, "/assets/") {
		return "/assets/*"
	}

	parts := strings.Split(p, "/")
	for i, part := range parts {
		if part == "" {
			continue
		}
		if looksLikeID(part) {
			parts[i] = ":id"
		}
	}
	return strings.Join(parts, "/")
}

// looksLikeID returns true for UUID-shaped strings and numeric IDs.
func looksLikeID(s string) bool {
	if len(s) == 36 && s[8] == '-' && s[13] == '-' && s[18] == '-' && s[23] == '-' {
		return true // UUID
	}
	if len(s) >= 8 {
		allDigit := true
		for _, c := range s {
			if c < '0' || c > '9' {
				allDigit = false
				break
			}
		}
		if allDigit {
			return true // Numeric ID (Zitadel IDs are 18-digit numbers)
		}
	}
	return false
}
