-- Migration: Add Dynamic Coffee Roulette Configuration Tables
-- Created: 2026-03-19
-- Purpose: Enable event organizers to create custom topics and questions for Coffee Roulette games

-- ─── Coffee Roulette Event Configuration ───
-- Stores event-specific settings for Coffee Roulette game
CREATE TABLE coffee_roulette_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  
  -- Game Settings
  duration_minutes INT NOT NULL DEFAULT 30,
  max_prompts INT NOT NULL DEFAULT 6,
  
  -- Topic Selection Strategy
  -- Options: 'random', 'sequential', 'weighted'
  topic_selection_strategy VARCHAR(50) NOT NULL DEFAULT 'random',
  
  -- Question/Prompt Selection Strategy
  -- Options: 'random', 'sequential', 'all'
  question_selection_strategy VARCHAR(50) NOT NULL DEFAULT 'random',
  
  -- Settings
  allow_general_questions BOOLEAN NOT NULL DEFAULT true, -- Use general questions as fallback
  shuffle_on_repeat BOOLEAN NOT NULL DEFAULT true, -- Reshuffle when reaching end of list
  
  -- Metadata
  created_by_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_config_event ON coffee_roulette_config(event_id);
CREATE INDEX idx_coffee_roulette_config_org_event ON coffee_roulette_config(created_by_member_id);

-- ─── Coffee Roulette Topics ───
-- Stores custom topics that can be used in Coffee Roulette
CREATE TABLE coffee_roulette_topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
  
  -- Content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(50), -- Emoji or icon name
  
  -- Weighting for topic selection
  -- Used if topic_selection_strategy is 'weighted'
  weight INT NOT NULL DEFAULT 1,
  
  -- Display order for sequential selection
  display_order INT NOT NULL DEFAULT 0,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  created_by_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_topics_config ON coffee_roulette_topics(config_id);
CREATE INDEX idx_coffee_roulette_topics_active ON coffee_roulette_topics(config_id, is_active);
CREATE INDEX idx_coffee_roulette_topics_order ON coffee_roulette_topics(config_id, display_order);

-- ─── Coffee Roulette Questions ───
-- Stores questions/prompts that can be assigned to topics or used generally
CREATE TABLE coffee_roulette_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
  
  -- Content
  text TEXT NOT NULL,
  category VARCHAR(100), -- e.g., 'icebreaker', 'personal', 'work', 'creative'
  difficulty VARCHAR(50) DEFAULT 'easy', -- easy, moderate, challenging
  
  -- Type
  -- 'general' = applies to all topics
  -- 'topic-specific' = assigned to specific topics
  question_type VARCHAR(50) NOT NULL DEFAULT 'general',
  
  -- Weighting for random selection
  weight INT NOT NULL DEFAULT 1,
  
  -- Display order for sequential selection
  display_order INT NOT NULL DEFAULT 0,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  created_by_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_questions_config ON coffee_roulette_questions(config_id);
CREATE INDEX idx_coffee_roulette_questions_type ON coffee_roulette_questions(config_id, question_type);
CREATE INDEX idx_coffee_roulette_questions_active ON coffee_roulette_questions(config_id, is_active);
CREATE INDEX idx_coffee_roulette_questions_order ON coffee_roulette_questions(config_id, display_order);

-- ─── Coffee Roulette Topic Questions Mapping ───
-- Defines which questions belong to which topics
CREATE TABLE coffee_roulette_topic_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id UUID NOT NULL REFERENCES coffee_roulette_topics(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES coffee_roulette_questions(id) ON DELETE CASCADE,
  
  -- Display order within topic
  display_order INT NOT NULL DEFAULT 0,
  
  -- Ensure no duplicates
  UNIQUE(topic_id, question_id),
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_topic_questions_topic ON coffee_roulette_topic_questions(topic_id);
CREATE INDEX idx_coffee_roulette_topic_questions_question ON coffee_roulette_topic_questions(question_id);

-- ─── Coffee Roulette Pair Context (Optional Tracking) ───
-- Tracks which questions were used for each pair pairing session
CREATE TABLE coffee_roulette_pair_context (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  
  -- Participants
  participant1_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  participant2_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  
  -- Session Info
  session_start_time TIMESTAMP NOT NULL DEFAULT NOW(),
  session_end_time TIMESTAMP,
  duration_seconds INT,
  
  -- Topic Used
  topic_id UUID REFERENCES coffee_roulette_topics(id) ON DELETE SET NULL,
  
  -- Questions Used
  questions_used UUID[] DEFAULT '{}', -- Array of question IDs shown during session
  questions_count INT NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_pair_context_event ON coffee_roulette_pair_context(event_id);
CREATE INDEX idx_coffee_roulette_pair_context_session ON coffee_roulette_pair_context(session_start_time);
CREATE INDEX idx_coffee_roulette_pair_context_topic ON coffee_roulette_pair_context(topic_id);

-- ─── Audit: Track configuration changes ───
CREATE TABLE coffee_roulette_config_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
  
  -- Change Info
  changed_by_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'deleted'
  entity_type VARCHAR(100) NOT NULL, -- 'config', 'topic', 'question', 'mapping'
  entity_id UUID,
  
  -- Change Details
  old_values JSONB,
  new_values JSONB,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coffee_roulette_config_audit_config ON coffee_roulette_config_audit(config_id);
CREATE INDEX idx_coffee_roulette_config_audit_member ON coffee_roulette_config_audit(changed_by_member_id);
CREATE INDEX idx_coffee_roulette_config_audit_timestamp ON coffee_roulette_config_audit(created_at);

-- ─── Rollback Statements (for reference) ───
-- DROP TABLE IF EXISTS coffee_roulette_config_audit CASCADE;
-- DROP TABLE IF EXISTS coffee_roulette_pair_context CASCADE;
-- DROP TABLE IF EXISTS coffee_roulette_topic_questions CASCADE;
-- DROP TABLE IF EXISTS coffee_roulette_questions CASCADE;
-- DROP TABLE IF EXISTS coffee_roulette_topics CASCADE;
-- DROP TABLE IF EXISTS coffee_roulette_config CASCADE;
