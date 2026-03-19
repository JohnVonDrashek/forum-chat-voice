package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
)

// LiveKitClient wraps the LiveKit Room Service API for creating/deleting rooms.
type LiveKitClient struct {
	roomClient *lksdk.RoomServiceClient
}

// NewLiveKitClient creates a new LiveKit room service client.
func NewLiveKitClient(livekitURL, apiKey, apiSecret string) *LiveKitClient {
	httpHost := strings.Replace(strings.Replace(livekitURL, "wss://", "https://", 1), "ws://", "http://", 1)
	return &LiveKitClient{
		roomClient: lksdk.NewRoomServiceClient(httpHost, apiKey, apiSecret),
	}
}

func (lk *LiveKitClient) CreateRoom(ctx context.Context, roomName string, metadata string) (*livekit.Room, error) {
	return lk.roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:             roomName,
		EmptyTimeout:     60,
		DepartureTimeout: 10,
		MaxParticipants:  2,
		Metadata:         metadata,
	})
}

func (lk *LiveKitClient) DeleteRoom(ctx context.Context, roomName string) error {
	_, err := lk.roomClient.DeleteRoom(ctx, &livekit.DeleteRoomRequest{
		Room: roomName,
	})
	return err
}

type CallService struct {
	Q           *sqlcdb.Queries
	PushService *PushService
	EventBus    pubsub.EventBus
	LK          *LiveKitClient
}

func NewCallService(q *sqlcdb.Queries, ps *PushService, bus pubsub.EventBus, lk *LiveKitClient) *CallService {
	return &CallService{Q: q, PushService: ps, EventBus: bus, LK: lk}
}

// RoomMetadata is stored as JSON in the LiveKit room metadata field.
type RoomMetadata struct {
	CallID         string `json:"call_id"`
	ConversationID string `json:"conversation_id"`
	CallerID       string `json:"caller_id"`
	CalleeID       string `json:"callee_id"`
}

type InitiateResult struct {
	Call *CallRecord
}

func (cs *CallService) Initiate(ctx context.Context, callerID string, conversationID uuid.UUID) (*InitiateResult, error) {
	calleeID, err := cs.Q.GetCalleeFor1to1(ctx, sqlcdb.GetCalleeFor1to1Params{
		UserID:         callerID,
		ConversationID: conversationID,
	})
	if err != nil {
		return nil, &NotFoundError{Msg: "1:1 conversation not found"}
	}

	roomName := fmt.Sprintf("call_%s_%d", conversationID.String(), time.Now().UnixMilli())

	row, err := cs.Q.CreateCallRecord(ctx, sqlcdb.CreateCallRecordParams{
		ConversationID: conversationID,
		CallerID:       callerID,
		CalleeID:       calleeID,
		RoomName:       &roomName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create call record: %w", err)
	}
	rn := ""
	if row.RoomName != nil {
		rn = *row.RoomName
	}
	call := &CallRecord{
		ID:             row.ID,
		ConversationID: row.ConversationID,
		CallerID:       row.CallerID,
		CalleeID:       row.CalleeID,
		Status:         row.Status,
		RoomName:       rn,
		CreatedAt:      row.CreatedAt.Format(time.RFC3339),
	}

	// Create LiveKit room with metadata
	if cs.LK != nil {
		meta := RoomMetadata{
			CallID:         call.ID.String(),
			ConversationID: conversationID.String(),
			CallerID:       callerID,
			CalleeID:       calleeID,
		}
		metaJSON, _ := json.Marshal(meta)
		if _, err := cs.LK.CreateRoom(ctx, roomName, string(metaJSON)); err != nil {
			log.Printf("[Call] Warning: failed to create LiveKit room %s: %v", roomName, err)
		}
	}

	// Get caller profile for display name in signal + push
	profile, err := cs.Q.GetProfile(ctx, callerID)
	displayName := "Unknown"
	callerUsername := ""
	var callerAvatarURL *string
	if err == nil {
		callerUsername = profile.Username
		displayName = profile.DisplayName
		if displayName == "" {
			displayName = callerUsername
		}
		callerAvatarURL = profile.AvatarUrl
	} else if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to get caller info: %w", err)
	}

	if cs.EventBus != nil {
		_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
			Type:              "incoming_call",
			CallID:            call.ID,
			ConversationID:    conversationID,
			CallerID:          callerID,
			CallerUsername:    callerUsername,
			CallerDisplayName: displayName,
			CallerAvatarURL:   callerAvatarURL,
			TargetUserID:      calleeID,
		})
	}

	go func() { // #nosec G118 -- push must outlive HTTP request
		title := fmt.Sprintf("Incoming call from %s", displayName)
		sent := cs.PushService.SendToUser(context.Background(), calleeID, title, "Tap to answer", "", "")
		if sent > 0 {
			log.Printf("Call push: sent %d notifications to %s", sent, calleeID)
		}
	}()

	return &InitiateResult{Call: call}, nil
}

type RespondResult struct {
	Status string
}

func (cs *CallService) Respond(ctx context.Context, userID string, callID uuid.UUID, action string) (*RespondResult, error) {
	if action != "accept" && action != "decline" {
		return nil, &ValidationError{Msg: "action must be 'accept' or 'decline'"}
	}

	call, err := cs.getCallByID(ctx, callID)
	if err != nil {
		return nil, &NotFoundError{Msg: "Call not found"}
	}
	if call.Status != "ringing" {
		return nil, &ConflictError{Msg: "Call is not ringing"}
	}
	if call.CalleeID != userID {
		return nil, &ForbiddenError{Msg: "Only the callee can respond"}
	}

	if action == "accept" {
		if cs.EventBus != nil {
			_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
				Type:         "call_accepted",
				CallID:       callID,
				TargetUserID: call.CallerID,
			})
		}
		_ = cs.Q.ActivateCall(ctx, callID)
		return &RespondResult{Status: "accepted"}, nil
	}

	// Decline
	if cs.LK != nil && call.RoomName != "" {
		if err := cs.LK.DeleteRoom(ctx, call.RoomName); err != nil {
			log.Printf("[Call] Warning: failed to delete LiveKit room %s on decline: %v", call.RoomName, err)
		}
	}
	_ = cs.Q.EndCallWithoutDuration(ctx, sqlcdb.EndCallWithoutDurationParams{
		Status: "declined",
		ID:     callID,
	})

	if cs.EventBus != nil {
		_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
			Type:         "call_declined",
			CallID:       callID,
			TargetUserID: call.CallerID,
		})
	}

	return &RespondResult{Status: "declined"}, nil
}

type EndResult struct {
	Status string
}

func (cs *CallService) End(ctx context.Context, userID string, callID uuid.UUID) (*EndResult, error) {
	call, err := cs.getCallByID(ctx, callID)
	if err != nil {
		return nil, &NotFoundError{Msg: "Call not found"}
	}
	if call.Status != "ringing" && call.Status != "active" {
		return nil, &ConflictError{Msg: "Call is not active"}
	}
	if call.CallerID != userID && call.CalleeID != userID {
		return nil, &ForbiddenError{Msg: "Not a participant"}
	}

	if cs.LK != nil && call.RoomName != "" {
		if err := cs.LK.DeleteRoom(ctx, call.RoomName); err != nil {
			log.Printf("[Call] Warning: failed to delete LiveKit room %s on end: %v", call.RoomName, err)
		}
	}

	newStatus := "completed"
	if call.Status == "ringing" {
		if userID == call.CallerID {
			newStatus = "cancelled"
		} else {
			newStatus = "missed"
		}
	}

	_ = cs.Q.EndCallWithoutDuration(ctx, sqlcdb.EndCallWithoutDurationParams{
		Status: newStatus,
		ID:     callID,
	})

	otherUserID := call.CalleeID
	if userID == call.CalleeID {
		otherUserID = call.CallerID
	}

	if cs.EventBus != nil {
		_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
			Type:         "call_ended",
			CallID:       callID,
			EndedBy:      userID,
			TargetUserID: otherUserID,
		})
	}

	return &EndResult{Status: newStatus}, nil
}

// HandleRoomFinished processes a LiveKit room_finished webhook event.
func (cs *CallService) HandleRoomFinished(ctx context.Context, roomName string, room *livekit.Room) {
	call, err := cs.getCallByRoomName(ctx, roomName)
	if err != nil {
		return
	}

	var durationSec int
	if room != nil && room.CreationTime > 0 {
		durationSec = int(time.Now().Unix() - room.CreationTime)
		if durationSec < 0 {
			durationSec = 0
		}
	}

	status := "completed"
	if call.Status == "ringing" {
		status = "missed"
	}

	if durationSec > 0 && call.Status == "active" {
		_ = cs.Q.EndCallWithDuration(ctx, sqlcdb.EndCallWithDurationParams{
			Status:          status,
			DurationSeconds: pgtype.Int4{Int32: int32(durationSec), Valid: true},
			ID:              call.ID,
		})
	} else {
		_ = cs.Q.EndCallWithoutDuration(ctx, sqlcdb.EndCallWithoutDurationParams{
			Status: status,
			ID:     call.ID,
		})
	}

	for _, targetID := range []string{call.CallerID, call.CalleeID} {
		if cs.EventBus != nil {
			_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
				Type:         "call_ended",
				CallID:       call.ID,
				TargetUserID: targetID,
			})
		}
	}
}

// HandleParticipantJoined processes a LiveKit participant_joined webhook event.
func (cs *CallService) HandleParticipantJoined(ctx context.Context, roomName string, numParticipants uint32) {
	if numParticipants < 2 {
		return
	}
	call, err := cs.getCallByRoomName(ctx, roomName)
	if err != nil {
		return
	}
	if call.Status != "ringing" {
		return
	}
	_ = cs.Q.ActivateCall(ctx, call.ID)
}

// GetCallByID returns a call record by ID (exported for handler use).
func (cs *CallService) GetCallByID(ctx context.Context, callID uuid.UUID) (*CallRecord, error) {
	return cs.getCallByID(ctx, callID)
}

// IsCallParticipant checks if a user is a participant in a call.
func (cs *CallService) IsCallParticipant(ctx context.Context, callID uuid.UUID, userID string) (bool, error) {
	return cs.Q.IsCallParticipant(ctx, sqlcdb.IsCallParticipantParams{
		ID:       callID,
		CallerID: userID,
	})
}

// GetProfileDisplayName returns the display name for a user (for LiveKit tokens).
func (cs *CallService) GetProfileDisplayName(ctx context.Context, userID string) string {
	profile, err := cs.Q.GetProfile(ctx, userID)
	if err != nil {
		return userID
	}
	if profile.DisplayName != "" {
		return profile.DisplayName
	}
	return profile.Username
}

func (cs *CallService) getCallByID(ctx context.Context, callID uuid.UUID) (*CallRecord, error) {
	row, err := cs.Q.GetCallByID(ctx, callID)
	if err != nil {
		return nil, err
	}
	return callRowToRecord(row.ID, row.ConversationID, row.CallerID, row.CalleeID,
		row.Status, row.RoomName, row.CreatedAt, row.StartedAt, row.EndedAt, row.DurationSeconds), nil
}

func (cs *CallService) getCallByRoomName(ctx context.Context, roomName string) (*CallRecord, error) {
	row, err := cs.Q.GetCallByRoomName(ctx, &roomName)
	if err != nil {
		return nil, err
	}
	return callRowToRecord(row.ID, row.ConversationID, row.CallerID, row.CalleeID,
		row.Status, row.RoomName, row.CreatedAt, row.StartedAt, row.EndedAt, row.DurationSeconds), nil
}
