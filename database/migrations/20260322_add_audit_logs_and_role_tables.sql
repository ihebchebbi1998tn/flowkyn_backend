-- Migration: Add audit_logs and strategic_escape_roles tables
-- Date: March 22, 2026
-- Purpose: Support audit trail for votes and secure role assignment
-- Database: PostgreSQL (Neon)

-- Ensure we're using the public schema
SET search_path TO public;

-- =========================================================================
-- Table 1: audit_logs - Track all game actions for investigation
-- =========================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  game_session_id uuid REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  
  -- Action type: vote_cast, vote_failed, role_assigned, role_revealed, etc.
  action varchar(100) NOT NULL,
  
  -- Details stored as JSON for flexibility
  details jsonb,
  
  -- IP address for security investigation
  ip_address inet,
  
  -- Status: success, error, retry
  status varchar(20) DEFAULT 'success',
  
  -- Timestamps
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);

-- PostgreSQL indexes (not MySQL INDEX syntax)
CREATE INDEX IF NOT EXISTS idx_audit_game_session ON audit_logs(game_session_id);
CREATE INDEX IF NOT EXISTS idx_audit_participant ON audit_logs(participant_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_logs(status);

-- =========================================================================
-- Table 2: strategic_escape_roles - Secure role assignments
-- =========================================================================

CREATE TABLE IF NOT EXISTS strategic_escape_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  
  -- Role name: ceo, cfo, cto, coo, hr_director
  role_name varchar(50) NOT NULL,
  
  -- Track when role was assigned and revealed
  assigned_at timestamp DEFAULT NOW(),
  revealed_at timestamp,
  
  -- Ensure one participant has only one role per session
  UNIQUE(game_session_id, participant_id)
);

-- PostgreSQL indexes for strategic_escape_roles
CREATE INDEX IF NOT EXISTS idx_strategic_game_session ON strategic_escape_roles(game_session_id);
CREATE INDEX IF NOT EXISTS idx_strategic_participant ON strategic_escape_roles(participant_id);
CREATE INDEX IF NOT EXISTS idx_strategic_role ON strategic_escape_roles(role_name);
CREATE INDEX IF NOT EXISTS idx_strategic_assigned ON strategic_escape_roles(assigned_at DESC);

-- =========================================================================
-- Composite indexes for common query patterns
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_audit_game_action_time 
  ON audit_logs(game_session_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_game_status 
  ON audit_logs(game_session_id, status, created_at DESC);

-- =========================================================================
-- Create function: update_audit_logs_timestamp
-- =========================================================================

CREATE OR REPLACE FUNCTION update_audit_logs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- Create trigger: update audit_logs timestamp on update
-- =========================================================================

DROP TRIGGER IF EXISTS audit_logs_update_timestamp ON audit_logs;
CREATE TRIGGER audit_logs_update_timestamp
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_audit_logs_timestamp();

-- =========================================================================
-- Comments for documentation
-- =========================================================================

COMMENT ON TABLE audit_logs IS 
  'Audit trail for all game actions. Used for investigation, dispute resolution, and security monitoring.';

COMMENT ON COLUMN audit_logs.action IS 
  'Type of action: vote_cast, vote_failed, role_assigned, etc.';

COMMENT ON COLUMN audit_logs.details IS 
  'JSON object with action-specific details (statement_id, error, etc.)';

COMMENT ON TABLE strategic_escape_roles IS 
  'Secure storage of role assignments for Strategic Escape games.';

COMMENT ON COLUMN strategic_escape_roles.revealed_at IS 
  'Timestamp when role was revealed to participant. NULL until discussion phase.';
