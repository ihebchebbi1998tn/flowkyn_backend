-- Flowkyn Database Schema
-- PostgreSQL (Neon compatible)

-- ─── Extensions ───
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users ───
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  language VARCHAR(10) NOT NULL DEFAULT 'en', -- en, fr, de
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, active, suspended
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- ─── User Sessions ───
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(512) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- ─── Email Verifications ───
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  otp_code VARCHAR(6),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_verifications_token ON email_verifications(token);
CREATE INDEX idx_email_verifications_otp ON email_verifications(otp_code) WHERE otp_code IS NOT NULL;

-- ─── Password Resets ───
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_password_resets_email ON password_resets(email);

-- ─── Organizations ───
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) UNIQUE NOT NULL,
  logo_url TEXT,
  description TEXT DEFAULT '',
  industry VARCHAR(50),
  company_size VARCHAR(20),
  goals TEXT[] DEFAULT '{}',
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Subscriptions ───
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_name VARCHAR(50) NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  max_users INT DEFAULT 10,
  max_events INT DEFAULT 5,
  billing_email VARCHAR(255),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);
CREATE UNIQUE INDEX idx_subscriptions_org ON subscriptions(organization_id);

-- ─── Roles & Permissions ───
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ─── Organization Members ───
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  invited_by_member_id UUID REFERENCES organization_members(id),
  is_subscription_manager BOOLEAN DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_org_members_unique ON organization_members(organization_id, user_id);

-- ─── Organization Invitations ───
CREATE TABLE organization_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  invited_by_member_id UUID REFERENCES organization_members(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_org_invitations_token ON organization_invitations(token);
CREATE INDEX idx_org_invitations_email ON organization_invitations(email);

-- ─── Events ───
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_member_id UUID NOT NULL REFERENCES organization_members(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_mode VARCHAR(20) DEFAULT 'sync', -- sync, async
  visibility VARCHAR(20) DEFAULT 'private', -- public, private
  max_participants INT DEFAULT 50,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  expires_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, active, completed, cancelled
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_org ON events(organization_id);
CREATE INDEX idx_events_status ON events(status);

-- ─── Event Settings ───
CREATE TABLE event_settings (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  allow_guests BOOLEAN DEFAULT true,
  allow_chat BOOLEAN DEFAULT true,
  auto_start_games BOOLEAN DEFAULT false,
  max_rounds INT DEFAULT 5
);

-- ─── Event Invitations ───
CREATE TABLE event_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  invited_by_member_id UUID REFERENCES organization_members(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_event_invitations_token ON event_invitations(token);

-- ─── Participants ───
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_member_id UUID REFERENCES organization_members(id),
  guest_name VARCHAR(100),
  guest_avatar VARCHAR(255),
  participant_type VARCHAR(20) NOT NULL DEFAULT 'member', -- member, guest
  invited_by_member_id UUID REFERENCES organization_members(id),
  joined_at TIMESTAMP,
  left_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_participants_event ON participants(event_id);
-- Optimize queries checking if participants were active within a time range
CREATE INDEX idx_participants_active_range ON participants(event_id, left_at, joined_at);
-- Prevent duplicate active participants
CREATE UNIQUE INDEX idx_participants_active ON participants(event_id, organization_member_id) WHERE left_at IS NULL AND organization_member_id IS NOT NULL;

-- ─── Event Messages ───
CREATE TABLE event_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_event_messages_event ON event_messages(event_id);
CREATE INDEX idx_event_messages_created ON event_messages(event_id, created_at);

-- ─── Game Types ───
CREATE TABLE game_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  is_sync BOOLEAN DEFAULT true,
  min_players INT DEFAULT 2,
  max_players INT DEFAULT 50,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Prompts ───
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type_id UUID NOT NULL REFERENCES game_types(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Game Sessions ───
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  game_type_id UUID NOT NULL REFERENCES game_types(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, paused, finished
  current_round INT DEFAULT 0,
  game_duration_minutes INT DEFAULT 30,
  expires_at TIMESTAMP,
  metadata JSONB,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);
CREATE INDEX idx_game_sessions_event ON game_sessions(event_id);
CREATE INDEX idx_game_sessions_status ON game_sessions(status);

-- ─── Game Rounds ───
CREATE TABLE game_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  round_duration_seconds INT DEFAULT 60,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  metadata JSONB,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);
CREATE UNIQUE INDEX idx_game_rounds_unique ON game_rounds(game_session_id, round_number);

-- ─── Game Actions ───
CREATE TABLE game_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES game_rounds(id),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_game_actions_session ON game_actions(game_session_id);
CREATE INDEX idx_game_actions_round ON game_actions(round_id);
-- Prevent double voting/actions: a participant can only submit one action of a specific type per round
CREATE UNIQUE INDEX idx_game_actions_unique ON game_actions(round_id, participant_id, action_type);

-- ─── Game State Snapshots ───
CREATE TABLE game_state_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Game Results ───
CREATE TABLE game_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  score INT DEFAULT 0,
  rank INT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_game_results_unique ON game_results(game_session_id, participant_id);

-- ─── Leaderboards ───
CREATE TABLE leaderboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type_id UUID NOT NULL REFERENCES game_types(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  season VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leaderboard_id UUID NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  score INT DEFAULT 0,
  rank INT,
  updated_at TIMESTAMP
);
CREATE UNIQUE INDEX idx_leaderboard_entries_unique ON leaderboard_entries(leaderboard_id, participant_id);

-- ─── Activity Posts ───
CREATE TABLE activity_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE post_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES activity_posts(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reaction_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Prevent duplicate reactions of same type by same participant
CREATE UNIQUE INDEX idx_post_reactions_unique ON post_reactions(post_id, participant_id, reaction_type);

-- ─── Files ───
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  file_type VARCHAR(100),
  original_name VARCHAR(255),
  size INT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_files_owner ON files(owner_user_id);

-- ─── Notifications ───
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  data JSONB,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- ─── Analytics Events ───
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name VARCHAR(100) NOT NULL,
  properties JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at);

-- ─── Audit Logs ───
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ─── Contact Submissions ───
CREATE TABLE contact_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  subject VARCHAR(200) DEFAULT '',
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new', -- new, read, replied, archived
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX idx_contact_submissions_created ON contact_submissions(created_at);

-- ─── Bug Reports / Ticketing System ───
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'bug_report', -- bug_report, feature_request, issue, general_feedback
  priority VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, in_progress, resolved, closed
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  resolved_at TIMESTAMP,
  closed_at TIMESTAMP,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bug_reports_user ON bug_reports(user_id);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);
CREATE INDEX idx_bug_reports_priority ON bug_reports(priority);
CREATE INDEX idx_bug_reports_assigned ON bug_reports(assigned_to_user_id);
CREATE INDEX idx_bug_reports_type ON bug_reports(type);
CREATE INDEX idx_bug_reports_created ON bug_reports(created_at);

-- ─── Bug Report Attachments ───
CREATE TABLE bug_report_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size INT NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_url TEXT NOT NULL, -- URL to cloud storage
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bug_attachments_report ON bug_report_attachments(bug_report_id);
CREATE INDEX idx_bug_attachments_uploader ON bug_report_attachments(uploaded_by_user_id);

-- ─── Bug Report History / Audit Trail ───
CREATE TABLE bug_report_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_type VARCHAR(20) NOT NULL DEFAULT 'update', -- create, update, comment
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bug_history_report ON bug_report_history(bug_report_id);
CREATE INDEX idx_bug_history_user ON bug_report_history(changed_by_user_id);
CREATE INDEX idx_bug_history_created ON bug_report_history(created_at);

-- ─── Seed Default Roles ───
INSERT INTO roles (id, name, description) VALUES
  (uuid_generate_v4(), 'owner', 'Organization owner with full access'),
  (uuid_generate_v4(), 'admin', 'Administrator with management access'),
  (uuid_generate_v4(), 'moderator', 'Can moderate events and content'),
  (uuid_generate_v4(), 'member', 'Standard organization member')
ON CONFLICT (name) DO NOTHING;

-- ─── Seed Default Game Types ───
INSERT INTO game_types (id, key, name, category, is_sync, min_players, max_players, description) VALUES
  (uuid_generate_v4(), 'two-truths', 'Two Truths and a Lie', 'icebreaker', true, 3, 30, 'Classic icebreaker where each person shares two truths and one lie.'),
  (uuid_generate_v4(), 'coffee-roulette', 'Coffee Roulette', 'connection', true, 2, 2, 'Random 1:1 pairings for virtual coffee chats.'),
  (uuid_generate_v4(), 'wins-of-week', 'Wins of the Week', 'wellness', false, 2, 999, 'Weekly thread where everyone shares one win from their week.'),
  (uuid_generate_v4(), 'trivia', 'Icebreaker Trivia', 'icebreaker', true, 2, 50, 'Fun trivia questions to get the team laughing and learning.'),
  (uuid_generate_v4(), 'scavenger-hunt', 'Team Scavenger Hunt', 'competition', true, 4, 50, 'Teams race to find and share items or complete challenges.'),
  (uuid_generate_v4(), 'gratitude', 'Gratitude Circle', 'wellness', false, 2, 999, 'Share one thing you appreciate about a colleague this week.')
ON CONFLICT (key) DO NOTHING;
