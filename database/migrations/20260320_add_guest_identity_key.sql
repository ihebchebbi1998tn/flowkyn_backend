-- Migration: Add guest identity key for stable re-identification
-- Created: 2026-03-20
-- Purpose: Persist a client-generated guest identity key per event to make
-- guest re-identification resilient across refreshes/reconnects.

ALTER TABLE participants
ADD COLUMN IF NOT EXISTS guest_identity_key VARCHAR(128);

-- Fast lookup for idempotent guest re-join by event + identity key.
CREATE INDEX IF NOT EXISTS idx_participants_guest_identity_lookup
ON participants(event_id, guest_identity_key)
WHERE participant_type = 'guest' AND left_at IS NULL AND guest_identity_key IS NOT NULL;

-- Prevent duplicate active guest identities in the same event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_guest_identity_unique_active
ON participants(event_id, guest_identity_key)
WHERE participant_type = 'guest' AND left_at IS NULL AND guest_identity_key IS NOT NULL;
