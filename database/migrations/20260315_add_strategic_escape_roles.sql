-- Add strategic-escape game type and strategic_roles table

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

