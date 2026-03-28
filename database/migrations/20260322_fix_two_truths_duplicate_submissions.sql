-- Migration: Fix Two Truths - Prevent Duplicate Submissions Per Round
-- Date: March 22, 2026
--
-- PROBLEM: Same participant can submit multiple statement sets in one round
--
-- Example of current bug:
--   Round 1:
--     - Participant A submits statements (first time)
--     - Participant A submits different statements (second time) ✗ BOTH RECORDED!
--     - Game confused about which set to use
--
-- This migration adds a unique constraint to prevent duplicate submissions.

-- ─── Add unique constraint for Two Truths submissions ───
-- Only applies to 'two_truths:submit' actions to avoid affecting other game types
ALTER TABLE game_actions
ADD CONSTRAINT unique_two_truths_submission 
UNIQUE (game_session_id, round_id, participant_id)
WHERE action_type = 'two_truths:submit';

-- ─── Add comment for documentation ───
COMMENT ON CONSTRAINT unique_two_truths_submission ON game_actions
IS 'Prevents duplicate Two Truths statement submissions in the same round.
Each participant can only submit once per round. Duplicate attempts are rejected.';

-- ─── Verification Query ───
-- After migration, run this to find any duplicate submissions:
-- SELECT 
--   game_session_id, 
--   round_id, 
--   participant_id, 
--   COUNT(*) as submission_count
-- FROM game_actions
-- WHERE action_type = 'two_truths:submit'
-- GROUP BY game_session_id, round_id, participant_id
-- HAVING COUNT(*) > 1;
--
-- Should return 0 rows (no duplicates)
