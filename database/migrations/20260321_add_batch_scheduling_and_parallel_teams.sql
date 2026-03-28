-- Migration: Add Batch Scheduling for Two Truths & Parallel Team Mode for Strategic Escape
-- Date: March 21, 2026
-- Purpose: Enable async scaling to 100+ players for Two Truths (batch mode) and Strategic Escape (parallel teams)

-- ─────────────────────────────────────────────────────────────────────────
-- ① TWO TRUTHS BATCH SCHEDULING SUPPORT
-- ─────────────────────────────────────────────────────────────────────────
-- Allows processing 10 players per batch: 100 players → 10 batches = 40 hours total
-- Instead of sequential: 100 players → 400 hours (1,200+ with slow networks)

-- Add execution mode to game_sessions
ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'sequential',
-- 'sequential' (1 presenter at a time) or 'batch' (10 presenters per round)
ADD COLUMN IF NOT EXISTS batch_size INT DEFAULT 10,
-- Number of presenters per batch (for batch mode)
ADD COLUMN IF NOT EXISTS total_batches INT,
-- Total number of batches (calculated: ceiling(participant_count / batch_size))
ADD COLUMN IF NOT EXISTS current_batch INT DEFAULT 0;
-- Current batch being processed (0-indexed)

-- Add batch information to game_rounds
ALTER TABLE game_rounds
ADD COLUMN IF NOT EXISTS batch_number INT,
-- Which batch this round belongs to (1, 2, 3, ..., n)
ADD COLUMN IF NOT EXISTS is_parallel BOOLEAN DEFAULT false,
-- Indicates this round supports parallel batch execution
ADD COLUMN IF NOT EXISTS submission_deadline TIMESTAMP,
-- Deadline for statement submissions (batch mode)
ADD COLUMN IF NOT EXISTS voting_deadline TIMESTAMP;
-- Deadline for voting (batch mode)

-- Create batch assignments table (tracks which participants are in which batch)
CREATE TABLE IF NOT EXISTS batch_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  batch_number INT NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  presenter_index INT,
  -- Presenter position within batch (0 = first, 1 = second, etc.)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_session_id, batch_number, participant_id)
);
CREATE INDEX idx_batch_assignments_session ON batch_assignments(game_session_id);
CREATE INDEX idx_batch_assignments_batch ON batch_assignments(game_session_id, batch_number);
CREATE INDEX idx_batch_assignments_presenter ON batch_assignments(game_session_id, presenter_index);

-- ─────────────────────────────────────────────────────────────────────────
-- ② STRATEGIC ESCAPE PARALLEL TEAM MODE
-- ─────────────────────────────────────────────────────────────────────────
-- Enables 100+ players by splitting into teams (e.g., 20 teams of 5)
-- Each team solves the same crisis independently and results are aggregated

-- Add team mode to game_sessions
ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS team_mode VARCHAR(20) DEFAULT 'single',
-- 'single' (all 1 team) or 'parallel' (multiple independent teams)
ADD COLUMN IF NOT EXISTS team_size INT DEFAULT 5,
-- Target players per team (Strategic Escape)
ADD COLUMN IF NOT EXISTS total_teams INT,
-- Total number of teams (calculated: ceiling(participant_count / team_size))
ADD COLUMN IF NOT EXISTS current_team_number INT DEFAULT 0;
-- For tracking team creation progress

-- Add team_id to strategic_roles (links players to their team)
ALTER TABLE strategic_roles
ADD COLUMN IF NOT EXISTS team_id VARCHAR(50),
-- Team identifier (e.g., 'team-1', 'team-2')
ADD COLUMN IF NOT EXISTS team_number INT;
-- Sequential team number (1, 2, 3, ..., n)

-- Create teams table (represents each parallel team in Strategic Escape)
CREATE TABLE IF NOT EXISTS game_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  team_number INT NOT NULL,
  team_id VARCHAR(50) NOT NULL,
  -- Team identifier visible to players (team-1, team-2, etc.)
  participant_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  -- 'active', 'completed', 'failed'
  discussion_channel_id VARCHAR(100),
  -- Reference to discussion channel/room if using external service
  final_solution TEXT,
  -- Team's final proposed solution (aggregated at end)
  team_created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_session_id, team_number),
  UNIQUE (game_session_id, team_id)
);
CREATE INDEX idx_game_teams_session ON game_teams(game_session_id);
CREATE INDEX idx_game_teams_team_id ON game_teams(game_session_id, team_id);

-- Create team results/comparison table
CREATE TABLE IF NOT EXISTS game_team_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  team_id VARCHAR(50) NOT NULL,
  -- Team identifier for cross-reference
  solution_summary TEXT,
  -- Concise summary of the solution
  approach VARCHAR(100),
  -- Primary approach used (e.g., 'customer-focused', 'operational-focused')
  effectiveness_score INT,
  -- How effective the solution was (1-10 scale)
  creativity_score INT,
  -- How creative the solution was (1-10 scale)
  collaboration_feedback TEXT,
  -- Qualitative feedback on team collaboration
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_session_id, team_id)
);
CREATE INDEX idx_game_team_results_session ON game_team_results(game_session_id);

-- ─────────────────────────────────────────────────────────────────────────
-- ③ PHASE TRANSITION TYPE (for deadline-based vs real-time)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS phase_transition_type VARCHAR(20) DEFAULT 'manual',
-- 'manual' (admin clicks), 'deadline-based' (auto on deadline), 'instant' (real-time sockets)
ADD COLUMN IF NOT EXISTS use_scheduled_deadlines BOOLEAN DEFAULT false;
-- Flag to enable deadline-based phase transitions instead of socket-based

-- ─────────────────────────────────────────────────────────────────────────
-- ④ COFFEE ROULETTE GROUP MODE SUPPORT
-- ─────────────────────────────────────────────────────────────────────────
-- Allows scaling from 1:1 pairs to 4-5 player groups
-- 100 players: 20 groups of 5 (vs 50 pairs currently)

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS group_size INT DEFAULT 2,
-- Group size: 2 (pairs) or 4-5 (groups)
ADD COLUMN IF NOT EXISTS group_matching_algorithm VARCHAR(50) DEFAULT 'round-robin';
-- Algorithm for grouping: 'round-robin', 'random', 'department-based'

-- Create groups table for Coffee Roulette
CREATE TABLE IF NOT EXISTS coffee_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_number INT NOT NULL,
  group_id VARCHAR(50) NOT NULL,
  -- Group identifier visible to players (group-1, group-2, etc.)
  topic TEXT,
  started_chat_at TIMESTAMP,
  chat_ends_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_session_id, group_number),
  UNIQUE (game_session_id, group_id)
);
CREATE INDEX idx_coffee_groups_session ON coffee_groups(game_session_id);
CREATE INDEX idx_coffee_groups_status ON coffee_groups(game_session_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- ⑤ INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────────────────

-- Indexes for batch operations
CREATE INDEX IF NOT EXISTS idx_game_sessions_execution_mode 
ON game_sessions(event_id, execution_mode) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_sessions_team_mode 
ON game_sessions(event_id, team_mode) WHERE status = 'active';

-- Indexes for deadline-based transitions
CREATE INDEX IF NOT EXISTS idx_game_sessions_phase_transition 
ON game_sessions(event_id, phase_transition_type) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_rounds_batch_deadline 
ON game_rounds(game_session_id, batch_number, voting_deadline) 
WHERE status = 'active';

-- Indexes for team tracking
CREATE INDEX IF NOT EXISTS idx_strategic_roles_team_id 
ON strategic_roles(game_session_id, team_id) WHERE team_id IS NOT NULL;

-- Indexes for group operations
CREATE INDEX IF NOT EXISTS idx_coffee_groups_deadline 
ON coffee_groups(game_session_id, chat_ends_at) 
WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────
-- ⑥ ROLLBACK INSTRUCTIONS
-- ─────────────────────────────────────────────────────────────────────────
-- If reverting this migration:
-- 1. DROP TABLE IF EXISTS batch_assignments CASCADE;
-- 2. DROP TABLE IF EXISTS game_teams CASCADE;
-- 3. DROP TABLE IF EXISTS game_team_results CASCADE;
-- 4. DROP TABLE IF EXISTS coffee_groups CASCADE;
-- 5. ALTER TABLE game_sessions DROP COLUMN IF EXISTS execution_mode, batch_size, 
--    total_batches, current_batch, team_mode, team_size, total_teams, 
--    current_team_number, phase_transition_type, use_scheduled_deadlines, 
--    group_size, group_matching_algorithm;
-- 6. ALTER TABLE game_rounds DROP COLUMN IF EXISTS batch_number, is_parallel, 
--    submission_deadline, voting_deadline;
-- 7. ALTER TABLE strategic_roles DROP COLUMN IF EXISTS team_id, team_number;

-- ─────────────────────────────────────────────────────────────────────────
-- ⑦ CONFIGURATION NOTES
-- ─────────────────────────────────────────────────────────────────────────
-- DEFAULT CONFIGURATIONS:
-- 
-- Two Truths (Sequential - Current):
--   execution_mode = 'sequential'
--   total_rounds = 4
--   Time: 100 players × 4 rounds × ~3 hours each = ~1,200 hours 😱
--
-- Two Truths (Batch Mode - Recommended for 50+):
--   execution_mode = 'batch'
--   batch_size = 10
--   total_batches = ceil(100 / 10) = 10 batches
--   total_rounds = 4
--   Time: 10 batches × 4 rounds × ~30 min each = ~40 hours ✅
--
-- Coffee Roulette (Pairs - Current):
--   group_size = 2
--   Time: 100 players = 50 pairs × ~30 min = ~25 hours
--
-- Coffee Roulette (Groups - Recommended for 50+):
--   group_size = 5
--   total_groups = ceil(100 / 5) = 20 groups
--   Time: 20 groups × ~30 min = ~10 hours ✅
--
-- Strategic Escape (Single Team - Current):
--   team_mode = 'single'
--   Works: 2-12 players perfectly
--   Issue: 100 players = 20 per role (redundant)
--
-- Strategic Escape (Parallel Teams - Recommended for 50+):
--   team_mode = 'parallel'
--   team_size = 5
--   total_teams = ceil(100 / 5) = 20 independent teams
--   Each team gets separate discussion channel
--   Results compared at end
--   Scales: 2-100+ players ✅
