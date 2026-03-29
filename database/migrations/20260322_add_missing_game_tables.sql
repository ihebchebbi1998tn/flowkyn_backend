-- Migration: Add Missing Game Tables
-- Date: 2026-03-22
-- Purpose: Add game_votes and coffee_roulette_unpaired tables that are referenced in code but missing from schema

-- ============================================================================
-- 1. CREATE game_votes TABLE
-- ============================================================================
-- Purpose: Atomically record votes in Two Truths voting phase to prevent race conditions
-- Used by: src/socket/gameHandlers.ts (Two Truths voting)
-- UNIQUE constraint: ensures one vote per participant per round

CREATE TABLE IF NOT EXISTS "game_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "round_id" uuid REFERENCES "game_rounds"("id") ON DELETE SET NULL,
  "participant_id" uuid NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "statement_id" varchar(10) NOT NULL,
  "voted_at" timestamp with time zone DEFAULT NOW() NOT NULL,
  "created_at" timestamp with time zone DEFAULT NOW() NOT NULL,
  
  -- Ensure one vote per participant per round
  CONSTRAINT "uk_game_votes_participant_round" 
    UNIQUE("game_session_id", "round_id", "participant_id")
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_game_votes_session" 
  ON "game_votes"("game_session_id");
CREATE INDEX IF NOT EXISTS "idx_game_votes_round" 
  ON "game_votes"("round_id");
CREATE INDEX IF NOT EXISTS "idx_game_votes_participant" 
  ON "game_votes"("participant_id");
CREATE INDEX IF NOT EXISTS "idx_game_votes_timestamp" 
  ON "game_votes"("voted_at");

-- ============================================================================
-- 2. CREATE coffee_roulette_unpaired TABLE
-- ============================================================================
-- Purpose: Track unpaired participants in Coffee Roulette due to odd number of players
-- Used by: src/socket/gameHandlers.ts (Coffee Roulette pairing logic)
-- UNIQUE constraint: prevents duplicate unpaired records for same participant in session

CREATE TABLE IF NOT EXISTS "coffee_roulette_unpaired" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "participant_id" uuid NOT NULL REFERENCES "participants"("id") ON DELETE CASCADE,
  "reason" varchar(255),
  "created_at" timestamp with time zone DEFAULT NOW() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT NOW() NOT NULL,
  
  -- Ensure one record per participant per session
  CONSTRAINT "uk_coffee_roulette_unpaired_session_participant" 
    UNIQUE("game_session_id", "participant_id")
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS "idx_coffee_roulette_unpaired_session" 
  ON "coffee_roulette_unpaired"("game_session_id");
CREATE INDEX IF NOT EXISTS "idx_coffee_roulette_unpaired_participant" 
  ON "coffee_roulette_unpaired"("participant_id");
CREATE INDEX IF NOT EXISTS "idx_coffee_roulette_unpaired_created" 
  ON "coffee_roulette_unpaired"("created_at");

-- ============================================================================
-- Summary: Schema Audit Results
-- ============================================================================
-- Tables added: 2
--   1. game_votes - for atomic vote recording (Two Truths)
--   2. coffee_roulette_unpaired - for tracking unpaired participants
-- 
-- Columns added: N/A (new tables only)
-- Indexes created: 7
-- 
-- Migration compatibility: Safe to run multiple times (uses IF NOT EXISTS)
-- Rollback strategy: Drop both tables if needed
-- ============================================================================

SELECT 'Migration 20260322: Added missing game_votes and coffee_roulette_unpaired tables' AS migration_status;
