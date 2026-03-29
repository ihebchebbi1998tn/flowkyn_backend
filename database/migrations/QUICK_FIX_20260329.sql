-- ═══════════════════════════════════════════════════════════════════════════
-- QUICK FIX: Critical Missing Columns & Tables
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes these specific errors:
-- ✅ "column "game_session_id" of relation "audit_logs" does not exist"
-- ✅ "column "end_action_timestamp" of relation "game_sessions" does not exist"
-- ✅ "relation "coffee_roulette_unpaired" does not exist"
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Add game_session_id to audit_logs
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS game_session_id UUID NULL;

-- Add end_action_timestamp to game_sessions
ALTER TABLE IF EXISTS game_sessions ADD COLUMN IF NOT EXISTS end_action_timestamp TIMESTAMP WITH TIME ZONE NULL;

-- Create coffee_roulette_unpaired table
CREATE TABLE IF NOT EXISTS coffee_roulette_unpaired (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT uk_coffee_roulette_unpaired_session_participant UNIQUE(game_session_id, participant_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_game_session ON audit_logs(game_session_id) WHERE game_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_sessions_end_action_timestamp ON game_sessions(end_action_timestamp) WHERE end_action_timestamp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coffee_roulette_unpaired_session ON coffee_roulette_unpaired(game_session_id);
CREATE INDEX IF NOT EXISTS idx_coffee_roulette_unpaired_participant ON coffee_roulette_unpaired(participant_id);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Run these queries to verify the fix worked:
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='audit_logs' AND column_name='game_session_id';
-- Expected: 1 row
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='game_sessions' AND column_name='end_action_timestamp';
-- Expected: 1 row
--
-- SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'coffee_roulette_unpaired');
-- Expected: true
-- ═══════════════════════════════════════════════════════════════════════════
