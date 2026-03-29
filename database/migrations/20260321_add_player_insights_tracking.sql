-- Migration: Add insights tracking for Two Truths game
-- Date: 2026-03-21
-- Purpose: Store player insights data (accuracy, best guesses, trickiest statements)

CREATE TABLE IF NOT EXISTS player_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  game_type VARCHAR(50) NOT NULL, -- 'two_truths', 'coffee_roulette', etc.
  
  -- Two Truths specific
  total_guesses INT DEFAULT 0,
  correct_guesses INT DEFAULT 0,
  accuracy_percentage FLOAT DEFAULT 0,
  best_guess_round INT,
  best_guess_statement TEXT,
  best_guess_accuracy_percentage FLOAT,
  trickiest_statement_text TEXT,
  trickiest_statement_fool_percentage FLOAT,
  
  -- General insights
  previous_accuracy_percentage FLOAT,
  percentile_rank FLOAT, -- 0-100, where 100 is top performer
  total_players_compared INT,
  
  -- Timestamps
  calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(game_session_id, participant_id)
);

CREATE INDEX idx_player_insights_session ON player_insights(game_session_id);
CREATE INDEX idx_player_insights_participant ON player_insights(participant_id);
CREATE INDEX idx_player_insights_game_type ON player_insights(game_type);
