-- Migration: Fix Strategic Escape - Ensure Role Key Uniqueness Per Session
-- Date: March 22, 2026
-- 
-- PROBLEM: Same role can be assigned to multiple participants in a single game session
-- 
-- Example of current bug:
--   Session A:
--     - Participant 1 → role_key = 'ceo'
--     - Participant 2 → role_key = 'ceo'  ✗ DUPLICATE!
--
-- This migration adds a UNIQUE constraint to prevent duplicate role assignments.

-- ─── Step 1: Add the unique constraint ───
ALTER TABLE strategic_roles
ADD CONSTRAINT unique_role_per_session UNIQUE (game_session_id, role_key);

-- ─── Step 2: Add comment for documentation ───
COMMENT ON CONSTRAINT unique_role_per_session ON strategic_roles 
IS 'Ensures each role is assigned to exactly one participant per game session. 
Prevents duplicate role assignments which would break Strategic Escape game logic.';

-- ─── Verification Query ───
-- After migration, run this to confirm no duplicates exist:
-- SELECT game_session_id, role_key, COUNT(*) as count
-- FROM strategic_roles
-- GROUP BY game_session_id, role_key
-- HAVING COUNT(*) > 1;
--
-- Should return 0 rows (no duplicates)
