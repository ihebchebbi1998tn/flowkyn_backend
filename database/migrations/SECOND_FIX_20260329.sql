-- ═══════════════════════════════════════════════════════════════════════════
-- SECOND FIX: Missing Columns (participant_id, resolved_at)
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes these errors:
-- ✅ "column "participant_id" of relation "audit_logs" does not exist"
-- ✅ "column "resolved_at" of relation "coffee_roulette_unpaired" does not exist"
-- ═══════════════════════════════════════════════════════════════════════════

-- Add participant_id to audit_logs
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'participant_id') THEN
    ALTER TABLE audit_logs ADD COLUMN participant_id UUID NULL;
  END IF;
END $$;

-- Add resolved_at to coffee_roulette_unpaired
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'coffee_roulette_unpaired' AND column_name = 'resolved_at') THEN
    ALTER TABLE coffee_roulette_unpaired ADD COLUMN resolved_at TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_participant ON audit_logs(participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coffee_roulette_unpaired_resolved ON coffee_roulette_unpaired(resolved_at) WHERE resolved_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- Run these to verify:
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='audit_logs' AND column_name='participant_id';
-- Expected: 1 row
--
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name='coffee_roulette_unpaired' AND column_name='resolved_at';
-- Expected: 1 row
-- ═══════════════════════════════════════════════════════════════════════════
