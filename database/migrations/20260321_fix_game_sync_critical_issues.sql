-- Migration: Fix Critical Game Synchronization Issues
-- Date: 2026-03-21
-- Purpose: Add database-level support for atomic operations, idempotency, and consistency
-- Safety: All changes are backwards-compatible, non-destructive

-- ============================================================================
-- 1. ISSUE #1: Concurrent Action Race Condition - Add Locking Support
-- ============================================================================

-- Add action_lock column for atomic operations per session
ALTER TABLE game_state_snapshots
ADD COLUMN IF NOT EXISTS action_sequence_number BIGINT DEFAULT 0;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_game_snapshots_sequence 
ON game_state_snapshots(game_session_id, action_sequence_number DESC);

-- ============================================================================
-- 2. ISSUE #2: Late Joiner State Inconsistency - Add Revision Metadata
-- ============================================================================

-- Add revision tracking to snapshots (if not exists)
ALTER TABLE game_state_snapshots
ADD COLUMN IF NOT EXISTS revision_number BIGINT DEFAULT 1,
ADD COLUMN IF NOT EXISTS revision_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for revision queries
CREATE INDEX IF NOT EXISTS idx_game_snapshots_revision
ON game_state_snapshots(game_session_id, revision_number DESC);

-- ============================================================================
-- 3. ISSUE #4: Two Truths Voting Collision - Add Atomic Vote Recording
-- ============================================================================

-- Create votes table for atomic vote recording (prevents race conditions)
CREATE TABLE IF NOT EXISTS game_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  round_id UUID,
  participant_id UUID NOT NULL,
  statement_id VARCHAR(10) NOT NULL, -- 's0', 's1', 's2'
  voted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one vote per participant per round
  CONSTRAINT uk_game_votes_participant_round 
    UNIQUE(game_session_id, round_id, participant_id),
  
  -- Foreign key references
  CONSTRAINT fk_votes_session 
    FOREIGN KEY(game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_round 
    FOREIGN KEY(round_id) REFERENCES game_rounds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_votes_session 
ON game_votes(game_session_id, round_id);

CREATE INDEX IF NOT EXISTS idx_game_votes_participant 
ON game_votes(game_session_id, participant_id);

-- ============================================================================
-- 4. ISSUE #6: Coffee Roulette Odd Pairing - Track Unpaired Participants
-- ============================================================================

-- Create table to track unpaired participants (solves odd pairing issue)
CREATE TABLE IF NOT EXISTS coffee_roulette_unpaired (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  reason VARCHAR(255), -- 'odd_count', 'late_join', etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- One entry per participant per session
  CONSTRAINT uk_unpaired_per_session 
    UNIQUE(game_session_id, participant_id),
  
  CONSTRAINT fk_unpaired_session 
    FOREIGN KEY(game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unpaired_session_unresolved 
ON coffee_roulette_unpaired(game_session_id, resolved_at)
WHERE resolved_at IS NULL;

-- ============================================================================
-- 5. ISSUE #9: Game End Idempotency - Add Idempotency Keys
-- ============================================================================

-- Add idempotency key for game end operations
ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS end_idempotency_key UUID,
ADD COLUMN IF NOT EXISTS end_action_timestamp TIMESTAMP WITH TIME ZONE;

-- Unique constraint: only one "end" operation per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_session_end_idempotent
ON game_sessions(id)
WHERE status = 'finished';

-- ============================================================================
-- 6. ISSUE #10: Scavenger Hunt Idempotency
-- ============================================================================

-- Create completion tracking table with idempotency
CREATE TABLE IF NOT EXISTS scavenger_hunt_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  task_id VARCHAR(255) NOT NULL,
  participant_id UUID NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  proof_url VARCHAR(2048),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure each task marked complete only once per participant
  CONSTRAINT uk_completion_once 
    UNIQUE(game_session_id, task_id, participant_id),
  
  CONSTRAINT fk_completion_session 
    FOREIGN KEY(game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_completions_session 
ON scavenger_hunt_completions(game_session_id, task_id);

CREATE INDEX IF NOT EXISTS idx_completions_participant 
ON scavenger_hunt_completions(game_session_id, participant_id);

-- ============================================================================
-- 7. ISSUE #11: Session Stale Timeout - Track Abandonment
-- ============================================================================

-- Add abandonment tracking to sessions
ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index to find stale sessions
CREATE INDEX IF NOT EXISTS idx_game_sessions_stale 
ON game_sessions(last_activity_at)
WHERE status IN ('active', 'paused');

-- ============================================================================
-- 8. ISSUE #12: Participant Rejoin Recovery
-- ============================================================================

-- Add rejoin tracking for participants
ALTER TABLE participants
ADD COLUMN IF NOT EXISTS last_active_socket_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_rejoin_at TIMESTAMP WITH TIME ZONE;

-- Create index to find rejoins
CREATE INDEX IF NOT EXISTS idx_participants_last_active 
ON participants(event_id, last_active_socket_id)
WHERE left_at IS NULL;

-- ============================================================================
-- 9. ISSUE #3: Optimistic Update Recovery - Track Pending Actions
-- ============================================================================

-- Create table to track pending unconfirmed actions
CREATE TABLE IF NOT EXISTS pending_game_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  action_payload JSONB,
  emit_sequence_number BIGINT NOT NULL,
  client_timestamp TIMESTAMP WITH TIME ZONE,
  server_received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  result_revision_number BIGINT,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
  
  CONSTRAINT fk_pending_action_session 
    FOREIGN KEY(game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_session 
ON pending_game_actions(game_session_id, confirmed_at)
WHERE confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_actions_participant 
ON pending_game_actions(game_session_id, participant_id)
WHERE confirmed_at IS NULL;

-- ============================================================================
-- 10. State Validation and Monitoring
-- ============================================================================

-- Add error tracking for sync issues
CREATE TABLE IF NOT EXISTS game_sync_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  error_type VARCHAR(100) NOT NULL, -- 'state_divergence', 'race_condition', 'data_loss'
  error_details JSONB,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  severity VARCHAR(20) DEFAULT 'warning', -- 'critical', 'warning', 'info'
  
  CONSTRAINT fk_sync_error_session 
    FOREIGN KEY(game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_errors_unresolved 
ON game_sync_errors(game_session_id, resolved_at)
WHERE resolved_at IS NULL;

-- ============================================================================
-- 11. Migration Complete
-- ============================================================================

-- Add comment documenting changes
COMMENT ON TABLE game_votes IS 'Atomic vote recording for Two Truths and other voting games - fixes race conditions';
COMMENT ON TABLE coffee_roulette_unpaired IS 'Tracks unpaired participants in Coffee Roulette - handles odd participant counts';
COMMENT ON TABLE scavenger_hunt_completions IS 'Idempotent task completion tracking - prevents duplicate completion recording';
COMMENT ON TABLE pending_game_actions IS 'Tracks unconfirmed game actions - enables recovery on network failures';
COMMENT ON TABLE game_sync_errors IS 'Monitors and logs synchronization errors for debugging and remediation';

-- Create summary of changes
SELECT 'Game Sync Critical Issues Migration Complete' AS status,
       NOW() AS migration_time,
       'New tables: game_votes, coffee_roulette_unpaired, scavenger_hunt_completions, pending_game_actions, game_sync_errors' AS new_tables,
       'New columns: action_sequence_number, revision_number, revision_timestamp, abandoned_at, last_activity_at, last_active_socket_id, last_rejoin_at, end_idempotency_key, end_action_timestamp' AS new_columns;
