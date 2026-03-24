-- =============================================================================
-- Flowkyn — Two Truths: verify related tables, ensure game_votes matches code
-- Date: 2026-03-24
--
-- Backend expects:
--   INSERT INTO game_votes (game_session_id, round_id, participant_id, statement_id)
--   ON CONFLICT (game_session_id, round_id, participant_id) DO UPDATE ...
--
-- Run in psql / Neon SQL editor against the SAME database as DATABASE_URL.
-- If ADD CONSTRAINT fails, run the backfill + DELETE steps again, then re-run.
-- =============================================================================

-- ─── 1) Report required parent tables ───────────────────────────────────────
SELECT 'CHECK: core tables' AS step;
SELECT table_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables t
         WHERE t.table_schema = 'public' AND t.table_name = x.table_name
       ) AS exists
FROM (VALUES
  ('game_sessions'),
  ('game_rounds'),
  ('participants'),
  ('game_actions'),
  ('game_votes')
) AS x(table_name);

-- ─── 2) Create game_votes if missing ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL,
  round_id uuid,
  participant_id uuid NOT NULL,
  statement_id varchar(10) NOT NULL,
  voted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FKs (add only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_votes_game_session_id_fkey'
  ) THEN
    ALTER TABLE public.game_votes
      ADD CONSTRAINT game_votes_game_session_id_fkey
      FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_votes_round_id_fkey'
  ) THEN
    ALTER TABLE public.game_votes
      ADD CONSTRAINT game_votes_round_id_fkey
      FOREIGN KEY (round_id) REFERENCES public.game_rounds(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_votes_participant_id_fkey'
  ) THEN
    ALTER TABLE public.game_votes
      ADD CONSTRAINT game_votes_participant_id_fkey
      FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_votes_session ON public.game_votes(game_session_id);
CREATE INDEX IF NOT EXISTS idx_game_votes_round ON public.game_votes(round_id);
CREATE INDEX IF NOT EXISTS idx_game_votes_participant ON public.game_votes(participant_id);

-- ─── 3) Backfill round_id (do BEFORE unique constraint) ───────────────────
UPDATE public.game_votes gv
SET round_id = sub.rid
FROM (
  SELECT gv2.id AS vid,
    (
      SELECT gr.id
      FROM public.game_rounds gr
      WHERE gr.game_session_id = gv2.game_session_id
        AND gr.status = 'active'
      ORDER BY gr.round_number DESC NULLS LAST, gr.created_at DESC NULLS LAST
      LIMIT 1
    ) AS rid
  FROM public.game_votes gv2
  WHERE gv2.round_id IS NULL
) sub
WHERE gv.id = sub.vid
  AND sub.rid IS NOT NULL;

UPDATE public.game_votes gv
SET round_id = sub.rid
FROM (
  SELECT gv2.id AS vid,
    (
      SELECT gr.id
      FROM public.game_rounds gr
      WHERE gr.game_session_id = gv2.game_session_id
      ORDER BY gr.round_number DESC NULLS LAST, gr.created_at DESC NULLS LAST
      LIMIT 1
    ) AS rid
  FROM public.game_votes gv2
  WHERE gv2.round_id IS NULL
) sub
WHERE gv.id = sub.vid
  AND sub.rid IS NOT NULL;

-- Collapse duplicate (session, round_id, participant_id), keep newest row
DELETE FROM public.game_votes a
USING public.game_votes b
WHERE a.id <> b.id
  AND a.game_session_id = b.game_session_id
  AND a.round_id IS NOT DISTINCT FROM b.round_id
  AND a.participant_id = b.participant_id
  AND a.created_at < b.created_at;

-- Collapse legacy rows that only differ by NULL round_id (same session + participant)
DELETE FROM public.game_votes
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY game_session_id, participant_id
        ORDER BY voted_at DESC NULLS LAST, created_at DESC NULLS LAST
      ) AS rn
    FROM public.game_votes
    WHERE round_id IS NULL
  ) t
  WHERE rn > 1
);

-- Re-run backfill after dedupe
UPDATE public.game_votes gv
SET round_id = sub.rid
FROM (
  SELECT gv2.id AS vid,
    (
      SELECT gr.id
      FROM public.game_rounds gr
      WHERE gr.game_session_id = gv2.game_session_id
      ORDER BY gr.round_number DESC NULLS LAST, gr.created_at DESC NULLS LAST
      LIMIT 1
    ) AS rid
  FROM public.game_votes gv2
  WHERE gv2.round_id IS NULL
) sub
WHERE gv.id = sub.vid
  AND sub.rid IS NOT NULL;

-- ─── 4) Unique constraint for ON CONFLICT (run after data is clean) ───────
-- Optional: drop wrong experimental constraint
-- ALTER TABLE public.game_votes DROP CONSTRAINT IF EXISTS uk_game_votes_session_participant;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON c.conrelid = r.oid
    WHERE r.relname = 'game_votes'
      AND c.conname = 'uk_game_votes_participant_round'
  ) THEN
    ALTER TABLE public.game_votes
      ADD CONSTRAINT uk_game_votes_participant_round
      UNIQUE (game_session_id, round_id, participant_id);
  END IF;
END $$;

-- Optional: after VERIFY shows cnt = 0 for orphaned votes:
-- ALTER TABLE public.game_votes ALTER COLUMN round_id SET NOT NULL;

-- ─── 5) Final verification ───────────────────────────────────────────────────
SELECT 'VERIFY: game_votes row count' AS step, count(*) AS game_votes_rows FROM public.game_votes;

SELECT 'VERIFY: orphaned votes (no round)' AS step, count(*) AS cnt
FROM public.game_votes WHERE round_id IS NULL;

SELECT 'VERIFY: unique constraint present' AS step, conname
FROM pg_constraint c
JOIN pg_class r ON c.conrelid = r.oid
WHERE r.relname = 'game_votes' AND c.contype = 'u';

SELECT 'DONE: migration 20260324_two_truths_game_votes_verify_and_fix' AS status;
