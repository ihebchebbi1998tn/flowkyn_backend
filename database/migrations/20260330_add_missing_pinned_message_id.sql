-- Migration: Add missing pinned_message_id to events table
-- Date: 2026-03-30
-- Description: Fixes "column e.pinned_message_id does not exist" error during getPinnedMessage

ALTER TABLE events 
ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES event_messages(id) ON DELETE SET NULL;
