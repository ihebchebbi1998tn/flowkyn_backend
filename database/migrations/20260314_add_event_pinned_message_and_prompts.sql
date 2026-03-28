-- Migration: add pinned message support and prompts endpoint helpers
-- Date: 2026-03-14

-- Add pinned_message_id to events to allow a single pinned chat message per event.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS pinned_message_id UUID NULL
    REFERENCES event_messages(id) ON DELETE SET NULL;

