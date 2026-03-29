-- Migration: Strategic Escape Game - Critical Fixes
-- Date: 2026-03-18
-- Purpose: Create role assignment system and persistence layer

-- ============================================================
-- Table 1: Game Participant Roles (Critical)
-- ============================================================
CREATE TABLE IF NOT EXISTS game_participant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  
  -- Stable keys for analytics and consistency
  role_key VARCHAR(50) NOT NULL,
  
  -- Display fields
  role_name VARCHAR(100) NOT NULL,
  
  -- Role-specific content (the actual game value)
  perspective TEXT NOT NULL,
  goals TEXT[] NOT NULL,
  hidden_agenda TEXT,
  constraints TEXT[] DEFAULT ARRAY[]::TEXT[],
  stakeholders TEXT[] DEFAULT ARRAY[]::TEXT[],
  key_questions TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Metadata
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(game_session_id, participant_id),
  CONSTRAINT valid_role_key CHECK (role_key ~ '^[a-z_]+$'),
  CONSTRAINT valid_role_key_length CHECK (length(role_key) BETWEEN 1 AND 50),
  CONSTRAINT valid_role_name CHECK (length(role_name) > 0)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_game_participant_roles_session 
  ON game_participant_roles(game_session_id);

CREATE INDEX IF NOT EXISTS idx_game_participant_roles_participant 
  ON game_participant_roles(participant_id);

CREATE INDEX IF NOT EXISTS idx_game_participant_roles_key 
  ON game_participant_roles(role_key);

-- ============================================================
-- Table 2: Game Session Extensions (for async timers)
-- ============================================================
ALTER TABLE game_sessions 
  ADD COLUMN IF NOT EXISTS discussion_ends_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS debrief_sent_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS role_assignment_completed_at TIMESTAMP NULL;

-- Add constraints
ALTER TABLE game_sessions
  ADD CONSTRAINT discussion_ends_after_start 
    CHECK (discussion_ends_at IS NULL OR discussion_ends_at > started_at) NOT VALID;

-- Index for discussion timeout queries
CREATE INDEX IF NOT EXISTS idx_game_sessions_discussion_timeout 
  ON game_sessions(discussion_ends_at) 
  WHERE discussion_ends_at IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_sessions_pending_debrief 
  ON game_sessions(id) 
  WHERE debrief_sent_at IS NULL AND status = 'finished';

-- ============================================================
-- Table 3: Game Actions Audit (enhance existing)
-- ============================================================
-- Ensure game_actions table has proper indices for queries
CREATE INDEX IF NOT EXISTS idx_game_actions_session_participant 
  ON game_actions(game_session_id, participant_id)
  WHERE action_type LIKE 'strategic:%';

CREATE INDEX IF NOT EXISTS idx_game_actions_timestamp 
  ON game_actions(created_at DESC);

-- ============================================================
-- Function: Validate role assignment prerequisites
-- ============================================================
CREATE OR REPLACE FUNCTION validate_role_assignment(
  p_session_id UUID,
  p_min_participants INT DEFAULT 2
) RETURNS TABLE(is_valid BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_session_exists BOOLEAN;
  v_participant_count INT;
  v_roles_already_assigned INT;
  v_session_status TEXT;
BEGIN
  -- Check session exists
  SELECT COUNT(*) > 0 INTO v_session_exists 
  FROM game_sessions WHERE id = p_session_id;
  
  IF NOT v_session_exists THEN
    RETURN QUERY SELECT FALSE, 'Session not found'::TEXT;
    RETURN;
  END IF;
  
  -- Check session status
  SELECT status INTO v_session_status 
  FROM game_sessions WHERE id = p_session_id;
  
  IF v_session_status != 'active' THEN
    RETURN QUERY SELECT FALSE, 'Session is not active'::TEXT;
    RETURN;
  END IF;
  
  -- Check participant count
  SELECT COUNT(*) INTO v_participant_count 
  FROM participants 
  WHERE event_id = (SELECT event_id FROM game_sessions WHERE id = p_session_id)
    AND left_at IS NULL;
  
  IF v_participant_count < p_min_participants THEN
    RETURN QUERY SELECT FALSE, format('Need at least %s participants (found %s)', p_min_participants, v_participant_count)::TEXT;
    RETURN;
  END IF;
  
  -- Check roles not already assigned
  SELECT COUNT(*) INTO v_roles_already_assigned 
  FROM game_participant_roles 
  WHERE game_session_id = p_session_id;
  
  IF v_roles_already_assigned > 0 THEN
    RETURN QUERY SELECT FALSE, 'Roles already assigned for this session'::TEXT;
    RETURN;
  END IF;
  
  -- All checks passed
  RETURN QUERY SELECT TRUE, 'All prerequisites met'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Grant permissions (if needed)
-- ============================================================
-- GRANT ALL ON game_participant_roles TO app_user;
-- GRANT EXECUTE ON FUNCTION validate_role_assignment TO app_user;

-- ============================================================
-- Migration status log
-- ============================================================
-- Tables created:
--   ✅ game_participant_roles (PRIMARY)
-- Tables modified:
--   ✅ game_sessions (added 3 columns)
-- Functions created:
--   ✅ validate_role_assignment()
-- Indices created: 8
-- Migration version: 20260318_strategic_escape_critical_fix
