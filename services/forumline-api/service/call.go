package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/forumline/forumline/services/forumline-api/model"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type CallService struct {
	Store       *store.Store
	PushService *PushService
}

func NewCallService(s *store.Store, ps *PushService) *CallService {
	return &CallService{Store: s, PushService: ps}
}

// InitiateResult contains the call record and the callee ID for SSE notification.
type InitiateResult struct {
	Call    *model.CallRecord
	Signal []byte // JSON signal payload to broadcast via SSE
}

// Initiate starts a call in a 1:1 conversation.
// Validates that the conversation is 1:1, no active call exists, and neither
// party is busy. Creates the call record, builds the SSE signal, and sends
// a push notification to the callee in the background.
func (cs *CallService) Initiate(ctx context.Context, callerID, conversationID string) (*InitiateResult, error) {
	if conversationID == "" {
		return nil, &ValidationError{Msg: "conversation_id is required"}
	}

	calleeID, err := cs.Store.GetCalleeFor1to1(ctx, callerID, conversationID)
	if err != nil {
		return nil, &NotFoundError{Msg: "1:1 conversation not found"}
	}

	if active, _ := cs.Store.HasActiveCall(ctx, conversationID); active {
		return nil, &ConflictError{Msg: "Call already in progress"}
	}
	if busy, _ := cs.Store.IsUserInCall(ctx, callerID); busy {
		return nil, &ConflictError{Msg: "You are already in a call"}
	}
	if busy, _ := cs.Store.IsUserInCall(ctx, calleeID); busy {
		return nil, &ConflictError{Msg: "User is busy"}
	}

	call, err := cs.Store.CreateCall(ctx, conversationID, callerID, calleeID)
	if err != nil {
		return nil, fmt.Errorf("failed to create call: %w", err)
	}

	callerProfile, err := cs.Store.GetProfile(ctx, callerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get caller info: %w", err)
	}
	displayName := "Unknown"
	callerUsername := ""
	var callerAvatarURL *string
	if callerProfile != nil {
		callerUsername = callerProfile.Username
		displayName = callerProfile.DisplayName
		if displayName == "" {
			displayName = callerUsername
		}
		callerAvatarURL = callerProfile.AvatarURL
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": "incoming_call", "call_id": call.ID, "conversation_id": call.ConversationID,
		"caller_id": callerID, "caller_username": callerUsername,
		"caller_display_name": displayName, "caller_avatar_url": callerAvatarURL,
		"target_user_id": calleeID,
	})
	_ = cs.Store.NotifyCallSignal(ctx, string(signalData))

	// Send push in background (intentionally detached from request context)
	go func() { // #nosec G118 -- push must outlive HTTP request
		title := fmt.Sprintf("Incoming call from %s", displayName)
		sent := cs.PushService.SendToUser(context.Background(), calleeID, title, "Tap to answer", "", "")
		if sent > 0 {
			log.Printf("Call push: sent %d notifications to %s", sent, calleeID)
		}
	}()

	return &InitiateResult{Call: call, Signal: signalData}, nil
}

// RespondResult contains the outcome of a call response.
type RespondResult struct {
	Status string // "accepted" or "declined"
}

// Respond handles accepting or declining a ringing call.
func (cs *CallService) Respond(ctx context.Context, userID, callID, action string) (*RespondResult, error) {
	if action != "accept" && action != "decline" {
		return nil, &ValidationError{Msg: "action must be 'accept' or 'decline'"}
	}

	callerID, err := cs.Store.GetRingingCallCallerID(ctx, callID, userID)
	if err != nil {
		return nil, &NotFoundError{Msg: "Call not found or already responded"}
	}

	signalType := "call_accepted"
	if action == "accept" {
		err = cs.Store.AcceptCall(ctx, callID)
	} else {
		err = cs.Store.DeclineCall(ctx, callID)
		signalType = "call_declined"
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update call: %w", err)
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": signalType, "call_id": callID, "target_user_id": callerID,
	})
	_ = cs.Store.NotifyCallSignal(ctx, string(signalData))

	return &RespondResult{Status: action + "ed"}, nil
}

// EndResult contains the outcome of ending a call.
type EndResult struct {
	Status string
}

// End terminates an active or ringing call.
func (cs *CallService) End(ctx context.Context, userID, callID string) (*EndResult, error) {
	newStatus, otherUserID, err := cs.Store.EndCall(ctx, callID, userID)
	if err != nil {
		return nil, &NotFoundError{Msg: "Active call not found"}
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": "call_ended", "call_id": callID, "ended_by": userID, "target_user_id": otherUserID,
	})
	_ = cs.Store.NotifyCallSignal(ctx, string(signalData))

	return &EndResult{Status: newStatus}, nil
}

// SignalInput represents a WebRTC signaling message.
type SignalInput struct {
	TargetUserID string
	CallID       string
	Type         string // "offer", "answer", or "ice-candidate"
	Payload      json.RawMessage
}

// Signal forwards a WebRTC signaling message between call participants.
func (cs *CallService) Signal(ctx context.Context, senderID string, input SignalInput) error {
	if input.TargetUserID == "" || input.CallID == "" || input.Payload == nil {
		return &ValidationError{Msg: "target_user_id, call_id, and payload are required"}
	}
	if input.Type != "offer" && input.Type != "answer" && input.Type != "ice-candidate" {
		return &ValidationError{Msg: "type must be offer, answer, or ice-candidate"}
	}

	valid, _ := cs.Store.VerifyCallParticipants(ctx, input.CallID, senderID, input.TargetUserID)
	if !valid {
		return &ForbiddenError{Msg: "Not a participant of this call"}
	}

	signalData, _ := json.Marshal(map[string]interface{}{
		"type": input.Type, "call_id": input.CallID, "sender_id": senderID,
		"target_user_id": input.TargetUserID, "payload": input.Payload,
	})
	_ = cs.Store.NotifyCallSignal(ctx, string(signalData))

	return nil
}
