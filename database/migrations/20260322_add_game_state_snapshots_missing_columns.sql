-- Migration: Add Missing Columns to game_state_snapshots
-- Date: 2026-03-22
-- Purpose: Add action_sequence_number and other tracking columns for game state synchronization

-- Add missing columns to game_state_snapshots table
ALTER TABLE game_state_snapshots
ADD COLUMN IF NOT EXISTS action_sequence_number BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS revision_number BIGINT DEFAULT 1,
ADD COLUMN IF NOT EXISTS revision_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_active_socket_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_rejoin_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS end_idempotency_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS end_action_timestamp TIMESTAMP WITH TIME ZONE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_game_snapshots_sequence 
ON game_state_snapshots(game_session_id, action_sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_game_snapshots_revision 
ON game_state_snapshots(game_session_id, revision_number DESC);

CREATE INDEX IF NOT EXISTS idx_game_snapshots_abandoned 
ON game_state_snapshots(game_session_id) WHERE abandoned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_snapshots_end_key 
ON game_state_snapshots(end_idempotency_key) WHERE end_idempotency_key IS NOT NULL;

-- Log migration completion
SELECT 'Migration 20260322: Added missing columns to game_state_snapshots' AS migration_status;
