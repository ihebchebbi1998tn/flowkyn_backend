-- ═══════════════════════════════════════════════════════════════════════════
-- NEON DATABASE EMERGENCY FIX - PostgreSQL Compatible
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- CRITICAL FIXES FOR GAME TEST TIMEOUTS
-- 
-- HOW TO RUN IN NEON:
-- 1. Go to: https://console.neon.tech/
-- 2. Click "SQL Editor" in left sidebar
-- 3. Click "New Query" button
-- 4. Copy the entire SQL script below (ALL OF IT)
-- 5. Paste into the SQL editor
-- 6. Click "Execute" button
-- 7. Wait for ~30 seconds
-- 8. You should see: "Query executed successfully"
-- 9. Then run the verification queries below
--
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Add the missing discussion_ends_at and debrief_sent_at columns
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS discussion_ends_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS debrief_sent_at TIMESTAMP NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Add the constraint (using DO block to handle if it exists)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  BEGIN
    ALTER TABLE game_sessions
      ADD CONSTRAINT discussion_ends_after_start
        CHECK (discussion_ends_at IS NULL OR discussion_ends_at > started_at);
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Create index for efficient discussion timeout lookups
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_game_sessions_discussion_timeout 
  ON game_sessions(discussion_ends_at) 
  WHERE discussion_ends_at IS NOT NULL AND status = 'active';

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Drop old TABLE/VIEW and create MATERIALIZED VIEW
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop as TABLE first (in case it was mistakenly created as a table)
DROP TABLE IF EXISTS admin_stats_cache CASCADE;

-- Drop as MATERIALIZED VIEW if it exists
DROP MATERIALIZED VIEW IF EXISTS admin_stats_cache CASCADE;

-- Drop as regular VIEW if it exists
DROP VIEW IF EXISTS admin_stats_cache CASCADE;

CREATE MATERIALIZED VIEW admin_stats_cache AS
SELECT
  (SELECT COUNT(*) FROM users) as total_users,
  (SELECT COUNT(*) FROM organizations) as total_organizations,
  (SELECT COUNT(*) FROM events) as total_events,
  (SELECT COUNT(*) FROM game_sessions) as total_game_sessions,
  (SELECT COUNT(DISTINCT user_id) FROM user_sessions 
   WHERE created_at > NOW() - INTERVAL '30 days') as active_users_30d,
  (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE) as new_users_today,
  (SELECT COUNT(*) FROM organizations WHERE created_at >= CURRENT_DATE) as new_orgs_today,
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
  NOW() as last_updated;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Create unique index on materialized view
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX idx_admin_stats_cache_unique 
  ON admin_stats_cache(last_updated);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Initial refresh of materialized view
-- ═══════════════════════════════════════════════════════════════════════════

REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Add missing batch scheduling columns
-- ═══════════════════════════════════════════════════════════════════════════

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
  ADD COLUMN IF NOT EXISTS group_matching_algorithm VARCHAR(50) DEFAULT 'round-robin',
  ADD COLUMN IF NOT EXISTS role_assignment_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'sequential';

-- ═══════════════════════════════════════════════════════════════════════════
-- ALL DONE - COMMIT
-- ═══════════════════════════════════════════════════════════════════════════

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES - Run these AFTER the migration above
-- ═══════════════════════════════════════════════════════════════════════════
--
-- After the migration completes, verify each fix by running these queries
-- in SEPARATE new SQL Editor windows (not in the same query as the migration).
--
-- --- VERIFICATION QUERY 1 ---
-- Check that discussion_ends_at column was added:
--
-- SELECT EXISTS (
--   SELECT 1 FROM information_schema.columns 
--   WHERE table_name='game_sessions' AND column_name='discussion_ends_at'
-- ) as "discussion_ends_at_exists";
--
-- Expected result: true
--
--
-- --- VERIFICATION QUERY 2 ---
-- Check that admin_stats_cache is now a materialized view:
--
-- SELECT matviewname FROM pg_matviews WHERE matviewname='admin_stats_cache';
--
-- Expected result: one row with "admin_stats_cache"
--
--
-- --- VERIFICATION QUERY 3 ---
-- Test that the materialized view refresh works:
--
-- REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache;
--
-- Expected result: No errors, completes in <5 seconds
--
--
-- --- VERIFICATION QUERY 4 ---
-- Check all new columns exist:
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='game_sessions' 
-- AND column_name IN (
--   'discussion_ends_at',
--   'batch_size',
--   'team_mode',
--   'execution_mode',
--   'role_assignment_completed_at'
-- )
-- ORDER BY column_name;
--
-- Expected result: All 5 columns listed
--
--
-- ═══════════════════════════════════════════════════════════════════════════
