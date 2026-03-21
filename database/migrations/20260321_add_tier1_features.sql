-- Feature Flags table for gradual rollouts and A/B testing
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  is_multivariant BOOLEAN DEFAULT FALSE,
  variants JSONB, -- {variant_a: {percentage: 50, config: {...}}, variant_b: {percentage: 50, config: {...}}}
  targeting_rules JSONB, -- {org_ids: [...], user_ids: [...], user_tags: [...]}
  created_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES "user" (id) ON DELETE SET NULL
);

-- Game content library for prompts, puzzles, etc
CREATE TABLE IF NOT EXISTS game_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key VARCHAR(100) NOT NULL, -- 'coffee_roulette', 'two_truths', 'strategic_escape', etc
  content_type VARCHAR(50) NOT NULL, -- 'prompt', 'puzzle', 'statement', 'challenge'
  title VARCHAR(255),
  content TEXT NOT NULL,
  difficulty_level VARCHAR(50), -- 'easy', 'medium', 'hard'
  created_by UUID NOT NULL,
  is_approved BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  usage_count INTEGER DEFAULT 0,
  average_rating DECIMAL(3, 2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES "user" (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES "user" (id) ON DELETE SET NULL
);

-- Content moderation queue
CREATE TABLE IF NOT EXISTS content_moderation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'flagged'
  reason_for_flag TEXT,
  flagged_by UUID,
  moderated_by UUID,
  moderation_notes TEXT,
  flagged_at TIMESTAMP DEFAULT NOW(),
  moderated_at TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES game_content (id) ON DELETE CASCADE,
  FOREIGN KEY (flagged_by) REFERENCES "user" (id) ON DELETE SET NULL,
  FOREIGN KEY (moderated_by) REFERENCES "user" (id) ON DELETE SET NULL
);

-- User engagement metrics for analytics
CREATE TABLE IF NOT EXISTS user_engagement_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  engagement_score DECIMAL(5, 2) DEFAULT 0, -- 0-100
  last_active_at TIMESTAMP,
  total_sessions INTEGER DEFAULT 0,
  total_messages_sent INTEGER DEFAULT 0,
  total_actions_performed INTEGER DEFAULT 0,
  avg_session_duration_minutes INTEGER DEFAULT 0,
  favorite_game_type VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  is_inactive_30d BOOLEAN DEFAULT FALSE,
  is_vip BOOLEAN DEFAULT FALSE,
  user_tags VARCHAR(255)[], -- array of tags
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

-- Organization engagement metrics
CREATE TABLE IF NOT EXISTS organization_engagement_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE,
  org_health_score DECIMAL(5, 2) DEFAULT 0, -- 0-100
  total_members INTEGER DEFAULT 0,
  active_members INTEGER DEFAULT 0,
  inactive_members INTEGER DEFAULT 0,
  total_sessions_this_month INTEGER DEFAULT 0,
  total_sessions_last_month INTEGER DEFAULT 0,
  member_growth_percentage DECIMAL(5, 2),
  feature_adoption_percentage DECIMAL(5, 2),
  last_activity_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organization (id) ON DELETE CASCADE
);

-- Analytics reports storage
CREATE TABLE IF NOT EXISTS analytics_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  report_type VARCHAR(50) NOT NULL, -- 'user_growth', 'engagement', 'revenue', 'sessions', 'custom'
  generated_by UUID NOT NULL,
  date_from DATE,
  date_to DATE,
  data JSONB, -- report data
  format VARCHAR(20) DEFAULT 'json', -- 'json', 'csv', 'pdf'
  is_scheduled BOOLEAN DEFAULT FALSE,
  schedule_frequency VARCHAR(50), -- 'daily', 'weekly', 'monthly'
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  FOREIGN KEY (generated_by) REFERENCES "user" (id) ON DELETE SET NULL
);

-- Feature flag evaluation history
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id UUID NOT NULL,
  user_id UUID,
  organization_id UUID,
  assigned_variant VARCHAR(100),
  evaluated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (flag_id) REFERENCES feature_flags (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id) REFERENCES organization (id) ON DELETE SET NULL
);

-- Create indexes for performance
CREATE INDEX idx_feature_flags_key ON feature_flags(key) WHERE deleted_at IS NULL;
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled) WHERE deleted_at IS NULL;
CREATE INDEX idx_game_content_game_key ON game_content(game_key) WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX idx_game_content_approved ON game_content(is_approved) WHERE is_active = TRUE;
CREATE INDEX idx_content_moderation_status ON content_moderation_queue(status);
CREATE INDEX idx_user_engagement_score ON user_engagement_metrics(engagement_score DESC);
CREATE INDEX idx_org_engagement_health ON organization_engagement_metrics(org_health_score DESC);
CREATE INDEX idx_analytics_reports_type ON analytics_reports(report_type);
CREATE INDEX idx_feature_flag_evaluations_user ON feature_flag_evaluations(user_id);
CREATE INDEX idx_feature_flag_evaluations_flag ON feature_flag_evaluations(flag_id);
