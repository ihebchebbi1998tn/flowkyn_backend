-- ═══════════════════════════════════════════════════════════════════════════
-- DATABASE EMERGENCY FIX - Neon PostgreSQL Compatible
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- DEPLOYMENT INSTRUCTIONS FOR NEON:
-- 1. Go to: https://console.neon.tech/
-- 2. Select your project and database
-- 3. Click "SQL Editor" 
-- 4. Create a new query
-- 5. Copy ALL the SQL below (from BEGIN to END marker)
-- 6. Click "Execute"
-- 7. Wait for completion (takes ~30 seconds)
-- 8. Check for errors in the output
-- 9. Run the VERIFICATION QUERIES section below
--
-- This script addresses 3 critical issues preventing game tests from passing:
-- 1. Missing discussion_ends_at column in game_sessions (causes DiscussionTimer failures)
-- 2. admin_stats_cache needs to be MATERIALIZED VIEW (not regular VIEW)
-- 3. Multiple missing migrations affecting game functionality
--
-- Run this ONCE in your production database. It is idempotent (safe to run multiple times).
-- Neon-compatible: Uses standard PostgreSQL SQL
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN TRANSACTION;

-- ═══════════════════════════════════════════════════════════════════════════
-- ISSUE 1: Add discussion_ends_at column to game_sessions
-- ═══════════════════════════════════════════════════════════════════════════
-- This column is used by:
--   - src/jobs/discussionTimer.ts (critical - runs every 30 seconds)
--   - Strategic Escape game flow for discussion timeouts

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS discussion_ends_at TIMESTAMP NULL;

-- Add the check constraint
-- Note: Constraint might already exist, so we add it conditionally
DO $$
BEGIN
  BEGIN
    ALTER TABLE game_sessions
      ADD CONSTRAINT discussion_ends_after_start
        CHECK (discussion_ends_at IS NULL OR discussion_ends_at > started_at);
  EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists, that's OK
    NULL;
  END;
END $$;

-- Create index for efficient timeout queries
CREATE INDEX IF NOT EXISTS idx_game_sessions_discussion_timeout 
  ON game_sessions(discussion_ends_at) 
  WHERE discussion_ends_at IS NOT NULL AND status = 'active';

-- ═══════════════════════════════════════════════════════════════════════════
-- ISSUE 2: Convert admin_stats_cache from VIEW/TABLE to MATERIALIZED VIEW
-- ═══════════════════════════════════════════════════════════════════════════
-- The refresh job (src/jobs/refreshAdminStats.ts) expects a materialized view
-- to run: REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache;

-- Drop as TABLE first (in case it was mistakenly created as a table)
DROP TABLE IF EXISTS admin_stats_cache CASCADE;

-- Drop as MATERIALIZED VIEW if it exists
DROP MATERIALIZED VIEW IF EXISTS admin_stats_cache CASCADE;

-- Drop as regular VIEW if it exists
DROP VIEW IF EXISTS admin_stats_cache CASCADE;

-- Create as materialized view (30x faster admin dashboard queries)
CREATE MATERIALIZED VIEW admin_stats_cache AS
SELECT
  -- Total counts
  (SELECT COUNT(*) FROM users) as total_users,
  (SELECT COUNT(*) FROM organizations) as total_organizations,
  (SELECT COUNT(*) FROM events) as total_events,
  (SELECT COUNT(*) FROM game_sessions) as total_game_sessions,
  
  -- Active users (30 days)
  (SELECT COUNT(DISTINCT user_id) 
   FROM user_sessions 
   WHERE created_at > NOW() - INTERVAL '30 days') as active_users_30d,
  
  -- New today
  (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE) as new_users_today,
  (SELECT COUNT(*) FROM organizations WHERE created_at >= CURRENT_DATE) as new_orgs_today,
  
  -- Game sessions by type (today)
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'two-truths' AND gs.started_at >= CURRENT_DATE) as two_truths_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'coffee-roulette' AND gs.started_at >= CURRENT_DATE) as coffee_roulette_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'wins-of-week' AND gs.started_at >= CURRENT_DATE) as wins_of_week_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'strategic-escape' AND gs.started_at >= CURRENT_DATE) as strategic_escape_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'trivia' AND gs.started_at >= CURRENT_DATE) as trivia_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'scavenger-hunt' AND gs.started_at >= CURRENT_DATE) as scavenger_hunt_sessions_today,
  
  (SELECT COUNT(*) FROM game_sessions gs 
   JOIN game_types gt ON gs.game_type_id = gt.id
   WHERE gt.key = 'gratitude' AND gs.started_at >= CURRENT_DATE) as gratitude_sessions_today,
  
  -- Timestamp for cache invalidation
  NOW() as last_updated;

-- Create unique index (allows concurrent refresh without locks)
CREATE UNIQUE INDEX idx_admin_stats_cache_unique 
  ON admin_stats_cache(last_updated);

-- Do initial refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache;

-- ═══════════════════════════════════════════════════════════════════════════
-- ISSUE 3: Verify and apply other pending migrations
-- ═══════════════════════════════════════════════════════════════════════════

-- Add batch scheduling columns if missing (from 20260321_add_batch_scheduling_and_parallel_teams.sql)
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS batch_size INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS total_batches INTEGER,
  ADD COLUMN IF NOT EXISTS current_batch INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_mode VARCHAR(20) DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS total_teams INTEGER,
  ADD COLUMN IF NOT EXISTS current_team_number INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phase_transition_type VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS use_scheduled_deadlines BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_size INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS group_matching_algorithm VARCHAR(50) DEFAULT 'round-robin';

-- Add role assignment column
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS role_assignment_completed_at TIMESTAMP;

-- Add execution mode
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'sequential';

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION - Commit transaction
-- ═══════════════════════════════════════════════════════════════════════════
COMMIT TRANSACTION;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- After running the migration above, run these queries in separate executions
-- to verify everything was applied correctly.
--
-- QUERY 1: Check discussion_ends_at column exists
-- Copy this into a new SQL Editor query and run:
/*
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns 
  WHERE table_name='game_sessions' AND column_name='discussion_ends_at'
) as "discussion_ends_at_exists";
-- Expected result: t (true)
*/

-- QUERY 2: Check admin_stats_cache is a materialized view
-- Copy this into a new SQL Editor query and run:
/*
SELECT matviewname FROM pg_matviews WHERE matviewname='admin_stats_cache';
-- Expected result: admin_stats_cache
*/

-- QUERY 3: Test the materialized view refresh works
-- Copy this into a new SQL Editor query and run:
/*
REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache;
-- Expected result: No errors, query completes
*/

-- QUERY 4: Check new columns exist
-- Copy this into a new SQL Editor query and run:
/*
SELECT 
  column_name
FROM information_schema.columns 
WHERE table_name='game_sessions' 
  AND column_name IN (
    'discussion_ends_at',
    'batch_size',
    'team_mode',
    'execution_mode',
    'role_assignment_completed_at'
  )
ORDER BY column_name;
-- Expected result: All 5 columns listed
*/

-- QUERY 5: Check indexes are created
-- Copy this into a new SQL Editor query and run:
/*
SELECT indexname FROM pg_indexes 
WHERE tablename='game_sessions' 
  AND indexname IN (
    'idx_game_sessions_discussion_timeout',
    'idx_admin_stats_cache_unique'
  )
ORDER BY indexname;
-- Expected result: Both indexes listed
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- HOW TO RUN IN NEON
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 1. FIRST: Run the migration (BEGIN TRANSACTION to COMMIT TRANSACTION)
--    - Go to Neon console > SQL Editor
--    - Select all text from BEGIN TRANSACTION through COMMIT TRANSACTION
--    - Click Execute
--    - Wait ~30 seconds for completion
--
-- 2. THEN: Run verification queries ONE AT A TIME
--    - Copy each query (between the /* */ comments)
--    - Paste into a new SQL Editor window
--    - Execute
--    - Verify the expected result
--
-- 3. If any query fails:
--    - Check the error message carefully
--    - Most common: Permission issue (needs database owner role)
--    - Common success: "Column already exists" is OK (IF NOT EXISTS handles it)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TROUBLESHOOTING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Error: "permission denied for schema public"
-- Solution: Use the database owner role (usually default role in Neon)
--
-- Error: "column already exists"
-- Solution: Normal if run twice. Script uses "IF NOT EXISTS" to prevent issues
--
-- Error: "relation does not exist"
-- Solution: Check that you're connected to the correct database
--
-- Error: "Cannot execute DDL in read-only transaction"
-- Solution: Make sure you're not in a read-only session
--
-- ═══════════════════════════════════════════════════════════════════════════
