package service

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type CallService struct {
	Store       *store.Store
	PushService *PushService
	EventBus    pubsub.EventBus
}

func NewCallService(s *store.Store, ps *PushService, bus pubsub.EventBus) *CallService {
	return &CallService{Store: s, PushService: ps, EventBus: bus}
}

type InitiateResult struct {
	Call *store.CallRecord
}

func (cs *CallService) Initiate(ctx context.Context, callerID string, conversationID uuid.UUID) (*InitiateResult, error) {
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

	callID, _ := uuid.Parse(call.ID.String())
	convoID, _ := uuid.Parse(call.ConversationID.String())

	if cs.EventBus != nil {
		_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
			Type:              "incoming_call",
			CallID:            callID,
			ConversationID:    convoID,
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

	if cs.EventBus != nil {
		_ = events.Publish(cs.EventBus, ctx, "call_signal", events.CallSignalEvent{
			Type:         signalType,
			CallID:       callID,
			TargetUserID: callerID,
		})
	}

	return &RespondResult{Status: action + "ed"}, nil
}

type EndResult struct {
	Status string
}

func (cs *CallService) End(ctx context.Context, userID string, callID uuid.UUID) (*EndResult, error) {
	newStatus, otherUserID, err := cs.Store.EndCall(ctx, callID, userID)
	if err != nil {
		return nil, &NotFoundError{Msg: "Active call not found"}
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
