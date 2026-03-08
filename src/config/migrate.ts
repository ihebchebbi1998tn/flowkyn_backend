/**
 * Auto-migration — creates all tables IF NOT EXISTS on startup.
 * Uses a migrations tracking table to run incremental migrations.
 */
import { pool } from './database';

/**
 * All migrations in order. Each runs exactly once (tracked by version).
 * Use CREATE IF NOT EXISTS / DO $$ blocks for idempotency as a safety net.
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

      -- Seed Default Roles
      INSERT INTO roles (id, name, description) VALUES
        (uuid_generate_v4(), 'owner', 'Organization owner with full access'),
        (uuid_generate_v4(), 'admin', 'Administrator with management access'),
        (uuid_generate_v4(), 'moderator', 'Can moderate events and content'),
        (uuid_generate_v4(), 'member', 'Standard organization member')
      ON CONFLICT (name) DO NOTHING;
    `,
  },
  // Future migrations go here:
  // { version: 2, name: 'add_user_locale', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';` },
];

/**
 * Run all pending migrations. Creates the tracking table if it doesn't exist.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

  },
  {
    version: 2,
    name: 'add_user_language',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
    `,
  },
];

    // Get already-applied versions
    const { rows: applied } = await client.query('SELECT version FROM _migrations ORDER BY version');
    const appliedSet = new Set(applied.map((r: any) => r.version));

    // Run pending migrations in order
    const pending = migrations.filter(m => !appliedSet.has(m.version));

    if (pending.length === 0) {
      console.log('✅ Database is up to date (no pending migrations)');
      return;
    }

    for (const migration of pending) {
      console.log(`🔄 Running migration v${migration.version}: ${migration.name}...`);

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
        console.log(`  ✅ Migration v${migration.version} applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Migration v${migration.version} failed:`, err);
        throw err;
      }
    }

    console.log(`✅ ${pending.length} migration(s) applied successfully`);
  } finally {
    client.release();
  }
}
