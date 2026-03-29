-- ═══════════════════════════════════════════════════════════════════════════
-- NEON FIX: Missing Columns & Tables (Complete Schema Fix)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This script fixes ALL missing columns/tables causing runtime errors:
-- - Missing columns in game_sessions (end_action_timestamp)
-- - Missing columns in audit_logs (game_session_id, participant_id, details, ip_address, status)
-- - Missing game_votes table
-- - Missing activity_posts.parent_post_id
-- - Missing coffee_roulette_unpaired table
--
-- HOW TO RUN IN NEON:
-- 1. Go to: https://console.neon.tech/
-- 2. Click "SQL Editor"
-- 3. Click "New Query"
-- 4. Copy and paste ALL the SQL below
-- 5. Click "Execute"
-- 6. Wait for completion
-- 7. You should see: "Query executed successfully"
--
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Add missing columns to game_sessions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS game_sessions
  ADD COLUMN IF NOT EXISTS discussion_ends_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS game_sessions
  ADD COLUMN IF NOT EXISTS debrief_sent_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS game_sessions
  ADD COLUMN IF NOT EXISTS end_idempotency_key VARCHAR(255) NULL;
ALTER TABLE IF EXISTS game_sessions
  ADD COLUMN IF NOT EXISTS end_action_timestamp TIMESTAMP WITH TIME ZONE NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: Add missing columns to audit_logs (comprehensive audit tracking)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS audit_logs
  ADD COLUMN IF NOT EXISTS game_session_id UUID NULL;
ALTER TABLE IF EXISTS audit_logs
  ADD COLUMN IF NOT EXISTS participant_id UUID NULL;
ALTER TABLE IF EXISTS audit_logs
  ADD COLUMN IF NOT EXISTS details TEXT NULL;
ALTER TABLE IF EXISTS audit_logs
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45) NULL;
ALTER TABLE IF EXISTS audit_logs
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: Add missing parent_post_id column to activity_posts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS activity_posts
  ADD COLUMN IF NOT EXISTS parent_post_id UUID NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: Recreate game_votes table (if missing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  round_id UUID,
  participant_id UUID NOT NULL,
  statement_id VARCHAR(10) NOT NULL,
  voted_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT uk_game_votes_participant_round UNIQUE(game_session_id, round_id, participant_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: Recreate coffee_roulette_unpaired table (if missing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coffee_roulette_unpaired (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT uk_coffee_roulette_unpaired_session_participant UNIQUE(game_session_id, participant_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────────────────────

-- Indexes for game_sessions
CREATE INDEX IF NOT EXISTS idx_game_sessions_discussion_timeout 
  ON game_sessions(discussion_ends_at) 
  WHERE discussion_ends_at IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_sessions_debrief 
  ON game_sessions(debrief_sent_at) 
  WHERE debrief_sent_at IS NOT NULL AND status = 'finished';

CREATE INDEX IF NOT EXISTS idx_game_sessions_end_idempotency 
  ON game_sessions(end_idempotency_key) 
  WHERE end_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_sessions_end_action_timestamp 
  ON game_sessions(end_action_timestamp) 
  WHERE end_action_timestamp IS NOT NULL;

-- Indexes for game_votes
CREATE INDEX IF NOT EXISTS idx_game_votes_session 
  ON game_votes(game_session_id);

CREATE INDEX IF NOT EXISTS idx_game_votes_round 
  ON game_votes(game_session_id, round_id)
  WHERE round_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_votes_participant 
  ON game_votes(participant_id);

-- Indexes for audit_logs (comprehensive audit tracking)
CREATE INDEX IF NOT EXISTS idx_audit_logs_event 
  ON audit_logs(event_id) 
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_game_session 
  ON audit_logs(game_session_id) 
  WHERE game_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_participant 
  ON audit_logs(participant_id) 
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user 
  ON audit_logs(user_id) 
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
  ON audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
  ON audit_logs(created_at DESC);

-- Indexes for activity_posts
CREATE INDEX IF NOT EXISTS idx_activity_posts_parent 
  ON activity_posts(parent_post_id) 
  WHERE parent_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_posts_event 
  ON activity_posts(event_id);

-- Indexes for coffee_roulette_unpaired
CREATE INDEX IF NOT EXISTS idx_coffee_roulette_unpaired_session 
  ON coffee_roulette_unpaired(game_session_id);

CREATE INDEX IF NOT EXISTS idx_coffee_roulette_unpaired_participant 
  ON coffee_roulette_unpaired(participant_id);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES - Run these AFTER the migration above
-- ═══════════════════════════════════════════════════════════════════════════
--
-- After the migration completes, verify by running these queries in SEPARATE
-- new SQL Editor windows (one query per window).
--
-- QUERY 1: Check all game_sessions columns exist
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='game_sessions' 
-- AND column_name IN ('discussion_ends_at', 'debrief_sent_at', 'end_idempotency_key', 'end_action_timestamp')
-- ORDER BY column_name;
--
-- Expected result: Four rows (all four columns)
--
--
-- QUERY 2: Check audit_logs has all required columns
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='audit_logs' 
-- AND column_name IN ('event_id', 'game_session_id', 'participant_id', 'details', 'ip_address', 'status')
-- ORDER BY column_name;
--
-- Expected result: Six rows (all six columns)
--
--
-- QUERY 3: Check activity_posts has parent_post_id
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='activity_posts' 
-- AND column_name = 'parent_post_id';
--
-- Expected result: One row (parent_post_id column)
--
--
-- QUERY 4: Check game_votes table exists with correct structure
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='game_votes'
-- ORDER BY ordinal_position;
--
-- Expected result: Seven rows (all game_votes columns)
--
--
-- QUERY 5: Check coffee_roulette_unpaired table exists
--
-- SELECT EXISTS (
--   SELECT 1 FROM information_schema.tables 
--   WHERE table_name = 'coffee_roulette_unpaired'
-- );
--
-- Expected result: true
--
--
-- QUERY 6: Verify all indexes were created (15 total)
--
-- SELECT COUNT(*) as index_count FROM pg_indexes 
-- WHERE indexname IN (
--   'idx_game_sessions_discussion_timeout',
--   'idx_game_sessions_debrief',
--   'idx_game_sessions_end_idempotency',
--   'idx_game_sessions_end_action_timestamp',
--   'idx_game_votes_session',
--   'idx_game_votes_round',
--   'idx_game_votes_participant',
--   'idx_audit_logs_event',
--   'idx_audit_logs_game_session',
--   'idx_audit_logs_participant',
--   'idx_audit_logs_user',
--   'idx_audit_logs_action',
--   'idx_audit_logs_timestamp',
--   'idx_activity_posts_parent',
--   'idx_activity_posts_event',
--   'idx_coffee_roulette_unpaired_session',
--   'idx_coffee_roulette_unpaired_participant'
-- );
--
-- Expected result: 17 (all indexes created)
--
-- ═══════════════════════════════════════════════════════════════════════════
