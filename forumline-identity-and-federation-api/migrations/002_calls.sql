-- Migration: Add 1:1 voice calling support.
-- Run this BEFORE deploying the new Go binary.

BEGIN;

CREATE TABLE IF NOT EXISTS forumline_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ringing',  -- ringing, active, completed, declined, missed, cancelled
  started_at TIMESTAMPTZ,        -- when callee accepted
  ended_at TIMESTAMPTZ,          -- when either party hung up
  duration_seconds INTEGER,      -- computed on end
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forumline_calls_conversation ON forumline_calls(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forumline_calls_active ON forumline_calls(status) WHERE status IN ('ringing', 'active');

COMMIT;
