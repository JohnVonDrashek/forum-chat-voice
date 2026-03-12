package model

import (
	"encoding/json"
	"time"
)

// --- Profiles ---

type Profile struct {
	ID               string  `json:"id"`
	Username         string  `json:"username"`
	DisplayName      string  `json:"display_name"`
	AvatarURL        *string `json:"avatar_url"`
	Bio              *string `json:"bio,omitempty"`
	StatusMessage    string  `json:"status_message"`
	OnlineStatus     string  `json:"online_status"`
	ShowOnlineStatus bool    `json:"show_online_status"`
}

type ProfileSearchResult struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

// --- Forums ---

type Forum struct {
	ID                  string    `json:"id"`
	Domain              string    `json:"domain"`
	Name                string    `json:"name"`
	IconURL             *string   `json:"icon_url"`
	APIBase             string    `json:"api_base"`
	WebBase             string    `json:"web_base"`
	Capabilities        []string  `json:"capabilities"`
	Description         *string   `json:"description"`
	ScreenshotURL       *string   `json:"screenshot_url"`
	Tags                []string  `json:"tags"`
	MemberCount         int       `json:"member_count"`
	OwnerID             *string   `json:"owner_id,omitempty"`
	Approved            bool      `json:"approved"`
	LastSeenAt          *time.Time `json:"last_seen_at,omitempty"`
	ConsecutiveFailures int       `json:"consecutive_failures,omitempty"`
	CreatedAt           time.Time `json:"created_at,omitempty"`
}

type ForumManifest struct {
	ForumlineVersion string   `json:"forumline_version"`
	Name             string   `json:"name"`
	Domain           string   `json:"domain"`
	IconURL          string   `json:"icon_url"`
	APIBase          string   `json:"api_base"`
	WebBase          string   `json:"web_base"`
	Capabilities     []string `json:"capabilities"`
	Tags             []string `json:"tags"`
}

// --- Memberships ---

type Membership struct {
	ForumDomain        string   `json:"forum_domain"`
	ForumName          string   `json:"forum_name"`
	ForumIconURL       *string  `json:"forum_icon_url"`
	APIBase            string   `json:"api_base"`
	WebBase            string   `json:"web_base"`
	Capabilities       []string `json:"capabilities"`
	JoinedAt           string   `json:"joined_at"`
	ForumAuthedAt      *string  `json:"forum_authed_at"`
	NotificationsMuted bool     `json:"notifications_muted"`
}

// --- Conversations ---

type ConversationMember struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

type Conversation struct {
	ID              string               `json:"id"`
	IsGroup         bool                 `json:"isGroup"`
	Name            *string              `json:"name"`
	Members         []ConversationMember `json:"members"`
	LastMessage     string               `json:"lastMessage"`
	LastMessageTime string               `json:"lastMessageTime"`
	UnreadCount     int                  `json:"unreadCount"`
}

type DirectMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
}

// --- Calls ---

type CallRecord struct {
	ID              string  `json:"id"`
	ConversationID  string  `json:"conversation_id"`
	CallerID        string  `json:"caller_id"`
	CalleeID        string  `json:"callee_id"`
	Status          string  `json:"status"`
	StartedAt       *string `json:"started_at"`
	EndedAt         *string `json:"ended_at"`
	DurationSeconds *int    `json:"duration_seconds"`
	CreatedAt       string  `json:"created_at"`
}

// --- OAuth ---

type OAuthClient struct {
	ID               string   `json:"id"`
	ForumID          string   `json:"forum_id"`
	ClientID         string   `json:"client_id"`
	ClientSecretHash string   `json:"-"`
	RedirectURIs     []string `json:"redirect_uris"`
}

type AuthCode struct {
	ID          string
	Code        string
	UserID      string
	ForumID     string
	RedirectURI string
	ExpiresAt   time.Time
	Used        bool
}

// --- Push ---

type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

// --- GoTrue responses ---

type GoTrueTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
	User         struct {
		ID           string                 `json:"id"`
		Email        string                 `json:"email"`
		UserMetadata map[string]interface{} `json:"user_metadata"`
	} `json:"user"`
}

// --- Push notification payload (from NOTIFY) ---

type PushDMPayload struct {
	ConversationID string   `json:"conversation_id"`
	SenderID       string   `json:"sender_id"`
	MemberIDs      []string `json:"member_ids"`
	Content        string   `json:"content"`
}

// --- Call signal payload ---

type CallSignal struct {
	Type           string          `json:"type"`
	CallID         string          `json:"call_id,omitempty"`
	ConversationID string          `json:"conversation_id,omitempty"`
	CallerID       string          `json:"caller_id,omitempty"`
	TargetUserID   string          `json:"target_user_id,omitempty"`
	SenderID       string          `json:"sender_id,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
}
