/**
 * Auto-migration — creates all tables IF NOT EXISTS on startup.
 * Uses a migrations tracking table to run incremental migrations.
 */
import { pool, stopPoolMonitor } from './database';


/**
 * All migrations in order. Each runs exactly once (tracked by version).
 */
const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- Extensions
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        avatar_url TEXT,
        language VARCHAR(10) NOT NULL DEFAULT 'en',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

      -- User Sessions
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token VARCHAR(512) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

      -- Email Verifications
      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);

      -- Password Resets
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
      CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);

      -- Organizations
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(120) UNIQUE NOT NULL,
        logo_url TEXT,
        owner_user_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Subscriptions
      CREATE TABLE IF NOT EXISTS subscriptions (
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);

      -- Roles & Permissions
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key VARCHAR(100) UNIQUE NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );

      -- Organization Members
      CREATE TABLE IF NOT EXISTS organization_members (
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_unique ON organization_members(organization_id, user_id);

      -- Organization Invitations
      CREATE TABLE IF NOT EXISTS organization_invitations (
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
      CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);
      CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email);

      -- Events
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_by_member_id UUID NOT NULL REFERENCES organization_members(id),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        event_mode VARCHAR(20) DEFAULT 'sync',
        visibility VARCHAR(20) DEFAULT 'private',
        max_participants INT DEFAULT 50,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        expires_at TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_org ON events(organization_id);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

      -- Event Settings
      CREATE TABLE IF NOT EXISTS event_settings (
        event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        allow_guests BOOLEAN DEFAULT true,
        allow_chat BOOLEAN DEFAULT true,
        auto_start_games BOOLEAN DEFAULT false,
        max_rounds INT DEFAULT 5
      );

      -- Event Invitations
      CREATE TABLE IF NOT EXISTS event_invitations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        invited_by_member_id UUID REFERENCES organization_members(id),
        token VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_event_invitations_token ON event_invitations(token);

      -- Participants
      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        organization_member_id UUID REFERENCES organization_members(id),
        guest_name VARCHAR(100),
        guest_avatar VARCHAR(255),
        participant_type VARCHAR(20) NOT NULL DEFAULT 'member',
        invited_by_member_id UUID REFERENCES organization_members(id),
        joined_at TIMESTAMP,
        left_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);

      -- Event Messages
      CREATE TABLE IF NOT EXISTS event_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id),
        message TEXT NOT NULL,
        message_type VARCHAR(20) DEFAULT 'text',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_event_messages_event ON event_messages(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_messages_created ON event_messages(event_id, created_at);

      -- Game Types
      CREATE TABLE IF NOT EXISTS game_types (
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

      -- Prompts
      CREATE TABLE IF NOT EXISTS prompts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_type_id UUID NOT NULL REFERENCES game_types(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        category VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Game Sessions
      CREATE TABLE IF NOT EXISTS game_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        game_type_id UUID NOT NULL REFERENCES game_types(id),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        current_round INT DEFAULT 0,
        total_rounds INT DEFAULT 4,
        game_duration_minutes INT DEFAULT 30,
        expires_at TIMESTAMP,
        metadata JSONB,
        started_at TIMESTAMP,
        ended_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_game_sessions_event ON game_sessions(event_id);
      CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status);

      -- Game Rounds
      CREATE TABLE IF NOT EXISTS game_rounds (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        round_number INT NOT NULL,
        round_duration_seconds INT DEFAULT 60,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSONB,
        started_at TIMESTAMP,
        ended_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rounds_unique ON game_rounds(game_session_id, round_number);

      -- Game Actions
      CREATE TABLE IF NOT EXISTS game_actions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        round_id UUID NOT NULL REFERENCES game_rounds(id),
        participant_id UUID NOT NULL REFERENCES participants(id),
        action_type VARCHAR(50) NOT NULL,
        payload JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_game_actions_session ON game_actions(game_session_id);
      CREATE INDEX IF NOT EXISTS idx_game_actions_round ON game_actions(round_id);

      -- Game State Snapshots
      CREATE TABLE IF NOT EXISTS game_state_snapshots (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        state JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Game Results
      CREATE TABLE IF NOT EXISTS game_results (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id),
        score INT DEFAULT 0,
        rank INT,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_results_unique ON game_results(game_session_id, participant_id);

      -- Leaderboards
      CREATE TABLE IF NOT EXISTS leaderboards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_type_id UUID NOT NULL REFERENCES game_types(id),
        organization_id UUID NOT NULL REFERENCES organizations(id),
        season VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS leaderboard_entries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        leaderboard_id UUID NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id),
        score INT DEFAULT 0,
        rank INT,
        updated_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_entries_unique ON leaderboard_entries(leaderboard_id, participant_id);

      -- Activity Posts
      CREATE TABLE IF NOT EXISTS activity_posts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        author_participant_id UUID NOT NULL REFERENCES participants(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS post_reactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        post_id UUID NOT NULL REFERENCES activity_posts(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id),
        reaction_type VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_post_reactions_unique ON post_reactions(post_id, participant_id, reaction_type);

      -- Files
      CREATE TABLE IF NOT EXISTS files (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        file_type VARCHAR(100),
        size INT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_user_id);

      -- Notifications
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        data JSONB,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

      -- Analytics Events
      CREATE TABLE IF NOT EXISTS analytics_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        event_name VARCHAR(100) NOT NULL,
        properties JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);

      -- Audit Logs
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

      -- Contact Submissions
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(200) DEFAULT '',
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        ip_address VARCHAR(45),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_contact_submissions_created ON contact_submissions(created_at);

      -- Seed Default Roles
      INSERT INTO roles (id, name, description) VALUES
        (uuid_generate_v4(), 'owner', 'Organization owner with full access'),
        (uuid_generate_v4(), 'admin', 'Administrator with management access'),
        (uuid_generate_v4(), 'moderator', 'Can moderate events and content'),
        (uuid_generate_v4(), 'member', 'Standard organization member')
      ON CONFLICT (name) DO NOTHING;

      -- Seed Default Game Types
      INSERT INTO game_types (id, key, name, category, is_sync, min_players, max_players, description) VALUES
        (uuid_generate_v4(), 'two-truths', 'Two Truths and a Lie', 'icebreaker', true, 3, 30, 'Classic icebreaker where each person shares two truths and one lie.'),
        (uuid_generate_v4(), 'coffee-roulette', 'Coffee Roulette', 'connection', true, 2, 2, 'Random 1:1 pairings for virtual coffee chats.'),
        (uuid_generate_v4(), 'wins-of-week', 'Wins of the Week', 'wellness', false, 2, 999, 'Weekly thread where everyone shares one win from their week.'),
        (uuid_generate_v4(), 'trivia', 'Icebreaker Trivia', 'icebreaker', true, 2, 50, 'Fun trivia questions to get the team laughing and learning.'),
        (uuid_generate_v4(), 'scavenger-hunt', 'Team Scavenger Hunt', 'competition', true, 4, 50, 'Teams race to find and share items or complete challenges.'),
        (uuid_generate_v4(), 'gratitude', 'Gratitude Circle', 'wellness', false, 2, 999, 'Share one thing you appreciate about a colleague this week.')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    version: 2,
    name: 'performance_indexes',
    sql: `
      -- ─── Additional indexes for high-traffic query patterns ───

      -- Audit logs: filter by user_id (admin dashboard)
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

      -- Participants: composite for join/leave lookups
      CREATE INDEX IF NOT EXISTS idx_participants_member ON participants(organization_member_id) WHERE left_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_participants_event_active ON participants(event_id) WHERE left_at IS NULL;

      -- Game actions: composite for aggregation queries (finishSession)
      CREATE INDEX IF NOT EXISTS idx_game_actions_session_participant ON game_actions(game_session_id, participant_id);

      -- Notifications: composite for sorted paginated queries
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

      -- Organizations: index on owner for admin queries
      CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_organizations_created ON organizations(created_at DESC);

      -- Events: composite for org + status filtered queries
      CREATE INDEX IF NOT EXISTS idx_events_org_status ON events(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

      -- Organization members: composite for user lookups across orgs
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id) WHERE status = 'active';

      -- Game sessions: composite for event lookups
      CREATE INDEX IF NOT EXISTS idx_game_sessions_event_status ON game_sessions(event_id, status);

      -- Users: updated_at for "active users" queries
      CREATE INDEX IF NOT EXISTS idx_users_updated ON users(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

      -- Leaderboard entries: composite for ranked queries
      CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_rank ON leaderboard_entries(leaderboard_id, rank ASC);

      -- Contact submissions: composite for admin queries
      CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_submissions(created_at DESC);

      -- Analytics: composite for time-series queries
      CREATE INDEX IF NOT EXISTS idx_analytics_user_created ON analytics_events(user_id, created_at DESC);
    `,
  },
  {
    version: 3,
    name: 'onboarding_and_org_details',
    sql: `
      -- Add onboarding_completed flag to users
      ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

      -- Add industry, company_size, description, goals to organizations
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry VARCHAR(50);
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_size VARCHAR(20);
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS goals TEXT[] DEFAULT '{}';

      -- Index for quick onboarding status lookups
      CREATE INDEX IF NOT EXISTS idx_users_onboarding ON users(onboarding_completed) WHERE onboarding_completed = false;
    `,
  },
  {
    version: 4,
    name: 'fix_participant_fk_cascades',
    sql: `
      -- Fix missing ON DELETE CASCADE on all foreign keys referencing participants(id).
      -- Without CASCADE, deleting an event (which cascades to participants) fails
      -- when child rows exist in these tables.

      ALTER TABLE event_messages DROP CONSTRAINT IF EXISTS event_messages_participant_id_fkey;
      ALTER TABLE event_messages ADD CONSTRAINT event_messages_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

      ALTER TABLE game_actions DROP CONSTRAINT IF EXISTS game_actions_participant_id_fkey;
      ALTER TABLE game_actions ADD CONSTRAINT game_actions_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

      ALTER TABLE game_results DROP CONSTRAINT IF EXISTS game_results_participant_id_fkey;
      ALTER TABLE game_results ADD CONSTRAINT game_results_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

      ALTER TABLE leaderboard_entries DROP CONSTRAINT IF EXISTS leaderboard_entries_participant_id_fkey;
      ALTER TABLE leaderboard_entries ADD CONSTRAINT leaderboard_entries_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

      ALTER TABLE activity_posts DROP CONSTRAINT IF EXISTS activity_posts_author_participant_id_fkey;
      ALTER TABLE activity_posts ADD CONSTRAINT activity_posts_author_participant_id_fkey
        FOREIGN KEY (author_participant_id) REFERENCES participants(id) ON DELETE CASCADE;

      ALTER TABLE post_reactions DROP CONSTRAINT IF EXISTS post_reactions_participant_id_fkey;
      ALTER TABLE post_reactions ADD CONSTRAINT post_reactions_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;
    `,
  },
  {
    version: 5,
    name: 'files_original_name',
    sql: `
      -- Add original_name column to files for display purposes
      ALTER TABLE files ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);
    `,
  },
  {
    version: 6,
    name: 'email_verifications_otp_code',
    sql: `
      -- Add OTP code column for 6-digit verification codes
      ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6);
      CREATE INDEX IF NOT EXISTS idx_email_verifications_otp ON email_verifications(otp_code) WHERE otp_code IS NOT NULL;
    `,
  },
  {
    version: 7,
    name: 'bugfixes_indexes_and_constraints',
    sql: `
      -- Optimize queries checking if participants were active within a time range
      CREATE INDEX IF NOT EXISTS idx_participants_active_range ON participants(event_id, left_at, joined_at);

      -- Prevent double voting/actions: a participant can only submit one action of a specific type per round
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_actions_unique ON game_actions(round_id, participant_id, action_type);
    `,
  },
  {
    version: 8,
    name: 'relax_game_actions_unique_constraint',
    sql: `
      -- Remove the overly strict unique index that prevents a participant from
      -- submitting the same action type more than once per round.
      -- This blocked game retries (e.g. re-submitting vote after reconnect) and
      -- snapshot-based state machines that process repeated actions.
      DROP INDEX IF EXISTS idx_game_actions_unique;
    `,
  },
  {
    version: 9,
    name: 'add_game_sessions_total_rounds',
    sql: `
      -- Add total_rounds for configurable game length (default 4)
      ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS total_rounds INT DEFAULT 4;
    `,
  },
  {
    version: 10,
    name: 'strategic_escape_bootstrap',
    sql: `
      -- Seed Strategic Escape game type (if missing)
      INSERT INTO game_types (id, key, name, category, is_sync, min_players, max_players, description)
      VALUES (
        uuid_generate_v4(),
        'strategic-escape',
        'Strategic Escape Challenge',
        'strategy',
        false,
        3,
        20,
        'Scenario-based strategic challenge with secret roles and async discussion.'
      )
      ON CONFLICT (key) DO NOTHING;

      -- Strategic roles table (if missing)
      CREATE TABLE IF NOT EXISTS strategic_roles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        role_key VARCHAR(50) NOT NULL,
        email_sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (game_session_id, participant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_strategic_roles_session ON strategic_roles(game_session_id);
    `,
  },
  {
    version: 11,
    name: 'event_settings_participant_game_control',
    sql: `
      -- Allow event creators/admins to decide who can control live game flow.
      -- Default is TRUE for backward compatibility with "anyone can manage".
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS allow_participant_game_control BOOLEAN NOT NULL DEFAULT true;
    `,
  },
  {
    version: 12,
    name: 'event_settings_updated_at',
    sql: `
      -- Controllers update event_settings.updated_at; ensure the column exists.
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    `,
  },
  {
    version: 13,
    name: 'participants_unique_active_member_per_event',
    sql: `
      -- Prevent multiple active participant rows for the same org member in an event.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_unique_active_member_event
        ON participants(event_id, organization_member_id)
        WHERE left_at IS NULL AND organization_member_id IS NOT NULL;
    `,
  },
  {
    version: 14,
    name: 'org_departments_and_member_mapping',
    sql: `
      -- ─── Departments (organization-scoped) ───
      CREATE TABLE IF NOT EXISTS departments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_org_name ON departments(organization_id, name);

      -- Link pending org invites to departments (email -> department grouping)
      ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS department_id UUID;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'organization_invitations_department_id_fkey'
        ) THEN
          ALTER TABLE organization_invitations
            ADD CONSTRAINT organization_invitations_department_id_fkey
            FOREIGN KEY (department_id)
            REFERENCES departments(id)
            ON DELETE CASCADE;
        END IF;
      END
      $$;

      -- Map active org members to departments (for event targeting)
      CREATE TABLE IF NOT EXISTS organization_member_departments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
        department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_org_member_departments_unique
        ON organization_member_departments(organization_member_id);

      -- Backfill legacy invites (if any) with NULL department_id:
      -- UI/backend will ignore missing dept ids for department-targeted events.
    `,
  },
  {
    version: 15,
    name: 'strategic_roles_revealed_at',
    sql: `
      -- Track when a participant has revealed/closed their secret role modal in-app
      ALTER TABLE strategic_roles
        ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_strategic_roles_revealed_at
        ON strategic_roles(game_session_id, revealed_at);
    `,
  },
  {
    version: 16,
    name: 'strategic_ready_prompts_notes',
    sql: `
      -- Track when a participant indicates they're ready to start discussion
      ALTER TABLE strategic_roles
        ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_strategic_roles_ready_at
        ON strategic_roles(game_session_id, ready_at);

      -- Track per-participant role prompt rotation (role-specific prompts shown in UI)
      ALTER TABLE strategic_roles
        ADD COLUMN IF NOT EXISTS prompt_index INT NOT NULL DEFAULT 0;
      ALTER TABLE strategic_roles
        ADD COLUMN IF NOT EXISTS prompt_updated_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_strategic_roles_prompt_index
        ON strategic_roles(game_session_id, prompt_index);

      -- Private notes per participant, per strategic session
      CREATE TABLE IF NOT EXISTS strategic_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (game_session_id, participant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_strategic_notes_session ON strategic_notes(game_session_id);
    `,
  },
  {
    version: 17,
    name: 'coffee_roulette_dynamic_config_tables',
    sql: `
      -- ─── Coffee Roulette Event Configuration ───
      -- Stores event-specific settings and selection strategies.
      CREATE TABLE IF NOT EXISTS coffee_roulette_config (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
        duration_minutes INT NOT NULL DEFAULT 30,
        max_prompts INT NOT NULL DEFAULT 6,
        topic_selection_strategy VARCHAR(50) NOT NULL DEFAULT 'random',
        question_selection_strategy VARCHAR(50) NOT NULL DEFAULT 'random',
        allow_general_questions BOOLEAN NOT NULL DEFAULT true,
        shuffle_on_repeat BOOLEAN NOT NULL DEFAULT true,
        -- Nullable to match ON DELETE SET NULL behavior
        created_by_member_id UUID REFERENCES organization_members(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_config_event ON coffee_roulette_config(event_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_config_org_event ON coffee_roulette_config(created_by_member_id);

      -- ─── Coffee Roulette Topics ───
      CREATE TABLE IF NOT EXISTS coffee_roulette_topics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(50),
        weight INT NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by_member_id UUID REFERENCES organization_members(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_topics_config ON coffee_roulette_topics(config_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_topics_active ON coffee_roulette_topics(config_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_topics_order ON coffee_roulette_topics(config_id, display_order);

      -- ─── Coffee Roulette Questions ───
      CREATE TABLE IF NOT EXISTS coffee_roulette_questions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        category VARCHAR(100),
        difficulty VARCHAR(50) DEFAULT 'easy',
        question_type VARCHAR(50) NOT NULL DEFAULT 'general',
        weight INT NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by_member_id UUID REFERENCES organization_members(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_questions_config ON coffee_roulette_questions(config_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_questions_type ON coffee_roulette_questions(config_id, question_type);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_questions_active ON coffee_roulette_questions(config_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_questions_order ON coffee_roulette_questions(config_id, display_order);

      -- ─── Topic -> Question Mapping ───
      CREATE TABLE IF NOT EXISTS coffee_roulette_topic_questions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        topic_id UUID NOT NULL REFERENCES coffee_roulette_topics(id) ON DELETE CASCADE,
        question_id UUID NOT NULL REFERENCES coffee_roulette_questions(id) ON DELETE CASCADE,
        display_order INT NOT NULL DEFAULT 0,
        UNIQUE(topic_id, question_id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_topic_questions_topic ON coffee_roulette_topic_questions(topic_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_topic_questions_question ON coffee_roulette_topic_questions(question_id);

      -- ─── Pair Context (optional tracking) ───
      CREATE TABLE IF NOT EXISTS coffee_roulette_pair_context (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        participant1_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        participant2_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        session_start_time TIMESTAMP NOT NULL DEFAULT NOW(),
        session_end_time TIMESTAMP,
        duration_seconds INT,
        topic_id UUID REFERENCES coffee_roulette_topics(id) ON DELETE SET NULL,
        questions_used UUID[] DEFAULT '{}',
        questions_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_pair_context_event ON coffee_roulette_pair_context(event_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_pair_context_session ON coffee_roulette_pair_context(session_start_time);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_pair_context_topic ON coffee_roulette_pair_context(topic_id);

      -- ─── Audit: Track configuration changes ───
      CREATE TABLE IF NOT EXISTS coffee_roulette_config_audit (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        config_id UUID NOT NULL REFERENCES coffee_roulette_config(id) ON DELETE CASCADE,
        changed_by_member_id UUID REFERENCES organization_members(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_config_audit_config ON coffee_roulette_config_audit(config_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_config_audit_member ON coffee_roulette_config_audit(changed_by_member_id);
      CREATE INDEX IF NOT EXISTS idx_coffee_roulette_config_audit_timestamp ON coffee_roulette_config_audit(created_at);
    `,
  },
  {
    version: 18,
    name: 'early_access_provision_delivery_state',
    sql: `
      -- Track account provisioning + credentials delivery state per request
      ALTER TABLE early_access_requests
        ADD COLUMN IF NOT EXISTS provisioned_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE early_access_requests
        ADD COLUMN IF NOT EXISTS account_provisioned_at TIMESTAMP;
      ALTER TABLE early_access_requests
        ADD COLUMN IF NOT EXISTS credentials_email_sent_at TIMESTAMP;
      ALTER TABLE early_access_requests
        ADD COLUMN IF NOT EXISTS last_email_error TEXT;
      ALTER TABLE early_access_requests
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

      CREATE INDEX IF NOT EXISTS idx_early_access_requests_provisioned_user
        ON early_access_requests(provisioned_user_id);
      CREATE INDEX IF NOT EXISTS idx_early_access_requests_account_provisioned
        ON early_access_requests(account_provisioned_at);
      CREATE INDEX IF NOT EXISTS idx_early_access_requests_email_sent
        ON early_access_requests(credentials_email_sent_at);
    `,
  },
  {
    version: 19,
    name: 'activity_feedbacks_table',
    sql: `
      -- ─── Activity Feedbacks (end-of-activity ratings/comments) ───
      CREATE TABLE IF NOT EXISTS activity_feedbacks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        game_session_id UUID REFERENCES game_sessions(id) ON DELETE SET NULL,
        game_type_key VARCHAR(50) NOT NULL, -- e.g. two-truths, coffee-roulette
        participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        reporter_name VARCHAR(200) NOT NULL,
        reporter_avatar_url TEXT,
        rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        category VARCHAR(50),
        comment TEXT NOT NULL,
        source VARCHAR(50) NOT NULL DEFAULT 'end_clicked', -- end_clicked, activity_completed, etc
        ip_address VARCHAR(45),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_activity_feedbacks_event_created
        ON activity_feedbacks(event_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_feedbacks_participant_created
        ON activity_feedbacks(participant_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_feedbacks_game_type_created
        ON activity_feedbacks(game_type_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_feedbacks_rating
        ON activity_feedbacks(rating);
    `,
  },
  {
    version: 20,
    name: 'dynamic_authoritative_timing',
    sql: `
      -- Hybrid timing model:
      -- 1) event_settings keeps organization/event defaults
      -- 2) game_sessions/game_rounds keep resolved deadlines used at runtime

      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS default_session_duration_minutes INT NOT NULL DEFAULT 30;
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS two_truths_submit_seconds INT NOT NULL DEFAULT 30;
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS two_truths_vote_seconds INT NOT NULL DEFAULT 20;
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS coffee_chat_duration_minutes INT NOT NULL DEFAULT 30;
      ALTER TABLE event_settings
        ADD COLUMN IF NOT EXISTS strategic_discussion_duration_minutes INT NOT NULL DEFAULT 45;

      ALTER TABLE game_sessions
        ADD COLUMN IF NOT EXISTS session_deadline_at TIMESTAMP;
      ALTER TABLE game_sessions
        ADD COLUMN IF NOT EXISTS resolved_timing JSONB;

      ALTER TABLE game_rounds
        ADD COLUMN IF NOT EXISTS round_deadline_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_game_sessions_deadline_active
        ON game_sessions(session_deadline_at)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_game_rounds_deadline_active
        ON game_rounds(round_deadline_at)
        WHERE status = 'active';
    `,
  },
  {
    version: 21,
    name: 'add_organization_ban_status',
    sql: `
      -- Add organization ban/status tracking for login validation
      -- Prevents users from logging in if their organization is banned
      
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS ban_reason TEXT;

      -- Create index for efficient status queries during login
      CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
    `,
  },
  {
    version: 22,
    name: 'add_event_profiles_table',
    sql: `
      -- Event profiles: per-participant custom names and avatars within an event
      -- Allows participants to have different display names in different events
      
      CREATE TABLE IF NOT EXISTS event_profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        display_name VARCHAR(100) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, participant_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_event_profiles_event ON event_profiles(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_profiles_participant ON event_profiles(participant_id);
    `,
  },
  {
    version: 23,
    name: 'add_bug_reporting_tables',
    sql: `
      -- ─── Bug Reports / Ticketing System ───
      CREATE TABLE IF NOT EXISTS bug_reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL,
        description TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'bug_report',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        status VARCHAR(50) NOT NULL DEFAULT 'open',
        assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        resolution_notes TEXT,
        resolved_at TIMESTAMP,
        closed_at TIMESTAMP,
        ip_address VARCHAR(45),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_priority ON bug_reports(priority);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_assigned ON bug_reports(assigned_to_user_id);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_type ON bug_reports(type);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at);

      -- ─── Bug Report Attachments ───
      CREATE TABLE IF NOT EXISTS bug_report_attachments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
        uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_size INT NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_url TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bug_attachments_report ON bug_report_attachments(bug_report_id);
      CREATE INDEX IF NOT EXISTS idx_bug_attachments_uploader ON bug_report_attachments(uploaded_by_user_id);

      -- ─── Bug Report History / Audit Trail ───
      CREATE TABLE IF NOT EXISTS bug_report_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
        changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        field_name VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        change_type VARCHAR(20) NOT NULL DEFAULT 'update',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bug_history_report ON bug_report_history(bug_report_id);
      CREATE INDEX IF NOT EXISTS idx_bug_history_user ON bug_report_history(changed_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_bug_history_created ON bug_report_history(created_at);
    `,
  },
];

/**
 * Run all pending migrations. Creates the tracking table if it doesn't exist.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure we're using the public schema (required for Neon PostgreSQL)
    await client.query('SET search_path TO public');

    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-applied versions
    const { rows: applied } = await client.query('SELECT version FROM _migrations ORDER BY version');
    const appliedVersions = new Set(applied.map((r: any) => r.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Migration v${migration.version} failed:`, err);
        throw err;
      }
    }

  } finally {
    client.release();
  }
}

/**
 * When this file is executed directly as a standalone script (e.g. via
 * `tsx src/config/migrate.ts` in the postbuild step), run migrations and
 * then shut down the connection pool so the process exits cleanly.
 *
 * When imported by the HTTP server (src/index.ts), this block is skipped.
 */
// require.main === module is the CommonJS equivalent of import.meta.url detection.
// tsx honours it correctly even when transpiling TypeScript directly.
if (require.main === module) {
  runMigrations()
    .then(() => {})
    .catch((err) => {
      console.error('Migration script failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      stopPoolMonitor();
      await pool.end();
    });
}
