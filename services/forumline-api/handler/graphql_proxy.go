package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/forumline/forumline/backend/auth"
)

// GraphQLProxy proxies requests to Hasura's GraphQL endpoint with JWT validation and session variables.
type GraphQLProxy struct {
	hasuraURL  string
	adminToken string
	client     *http.Client
}

// NewGraphQLProxy creates a new GraphQL proxy.
func NewGraphQLProxy(hasuraURL, adminToken string) *GraphQLProxy {
	return &GraphQLProxy{
		hasuraURL:  strings.TrimSuffix(hasuraURL, "/"),
		adminToken: adminToken,
		client:     &http.Client{},
	}
}

// Handler handles GraphQL requests by proxying them to Hasura with JWT validation.
func (gp *GraphQLProxy) Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	_ = r.Body.Close()

	// Parse GraphQL request
	var gqlReq GraphQLRequest
	if err := json.Unmarshal(body, &gqlReq); err != nil {
		http.Error(w, "Invalid GraphQL request", http.StatusBadRequest)
		return
	}

	// Get user ID from context (set by auth middleware)
	userID := auth.UserIDFromContext(r.Context())

	// Add session variables for Hasura RLS
	if gqlReq.Variables == nil {
		gqlReq.Variables = make(map[string]interface{})
	}

	// Create new request with admin secret (Hasura handles RLS via session variables)
	proxyURL := gp.hasuraURL + "/v1/graphql"
	reqBody, _ := json.Marshal(gqlReq)

	proxyReq, _ := http.NewRequestWithContext(r.Context(), "POST", proxyURL, bytes.NewReader(reqBody))
	proxyReq.Header.Set("Content-Type", "application/json")
	proxyReq.Header.Set("X-Hasura-Admin-Secret", gp.adminToken)

	// Pass session variables to Hasura (for RLS)
	if userID != "" {
		proxyReq.Header.Set("X-Hasura-User-Id", userID)
		proxyReq.Header.Set("X-Hasura-Role", "user") // Or derive from JWT claims
	}

	// Proxy the request
	resp, err := gp.client.Do(proxyReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("Hasura request failed: %v", err), http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	// Read Hasura response
	respBody, _ := io.ReadAll(resp.Body)

	// Return response to client
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}
