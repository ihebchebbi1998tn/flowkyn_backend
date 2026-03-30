-- Add game_id to event_settings so each event remembers which activity was chosen
ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS game_id VARCHAR(50) DEFAULT NULL;
