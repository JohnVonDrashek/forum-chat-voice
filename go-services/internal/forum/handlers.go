package forum

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/go-services/internal/shared"
)

// Handlers holds dependencies for all forum API handlers.
type Handlers struct {
	Pool   *pgxpool.Pool
	SSEHub *shared.SSEHub
	Config *Config
}

// Config holds environment-driven configuration for the forum server.
type Config struct {
	GoTrueURL            string
	ServiceRoleKey       string
	SiteURL              string
	Domain               string
	ForumlineURL               string
	ForumlineClientID          string
	ForumlineClientSecret      string
	ForumlineJWTSecret         string
	ForumlineSupabaseURL       string
	ForumlineServiceRoleKey    string
	LiveKitURL           string
	LiveKitAPIKey        string
	LiveKitAPISecret     string
	R2AccountID          string
	R2AccessKeyID        string
	R2SecretAccessKey    string
	R2BucketName         string
	R2PublicURL          string
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func parseCookies(r *http.Request) map[string]string {
	cookies := make(map[string]string)
	for _, c := range r.Cookies() {
		cookies[c.Name] = c.Value
	}
	return cookies
}
