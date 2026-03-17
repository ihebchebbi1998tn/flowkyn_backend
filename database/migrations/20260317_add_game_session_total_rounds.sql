-- Add total_rounds column to game_sessions for configurable game length
-- Default is 4 to match existing hardcoded logic
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS total_rounds INTEGER DEFAULT 4;
