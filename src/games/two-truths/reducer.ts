import { query, queryOne } from '../../config/database';

export type TwoTruthsState = {
  kind: 'two-truths';
  phase: 'waiting' | 'submit' | 'vote' | 'reveal' | 'results';
  round: number;
  totalRounds: number;
  presenterParticipantId: string | null;
  statements: { id: 's0' | 's1' | 's2'; text: string }[] | null;
  votes: Record<string, 's0' | 's1' | 's2'>;
  revealedLie: 's0' | 's1' | 's2' | null;
  correctLieId?: 's0' | 's1' | 's2';
  scores: Record<string, number>;
  submitEndsAt?: string;
  voteEndsAt?: string;
  submitSeconds?: number;
  voteSeconds?: number;
  gameStatus?: 'waiting' | 'in_progress' | 'finished';
};

export function sanitizeTwoTruthsStateForPublic(state: unknown): unknown {
  if (!state || typeof state !== 'object') return state;
  const s = state as TwoTruthsState & Record<string, unknown>;
  if (s.kind !== 'two-truths') return state;
  if (s.phase !== 'vote') return state;
  const { correctLieId: _, ...rest } = s;
  return rest;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function reduceTwoTruthsState(args: {
  eventId: string;
  sessionId?: string;
  participantId: string;
  actionType: string;
  payload: any;
  prev: TwoTruthsState | null;
  session?: any;
  activeRoundId?: string | null;
}): Promise<TwoTruthsState> {
  const { eventId, participantId, actionType, payload, prev, session, activeRoundId } = args;

  const base: TwoTruthsState = prev || {
    kind: 'two-truths',
    phase: 'waiting',
    round: 1,
    totalRounds: session?.total_rounds || 4,
    presenterParticipantId: null,
    statements: null,
    votes: {},
    revealedLie: null,
    scores: {},
    submitSeconds: Number(session?.resolved_timing?.twoTruths?.submitSeconds || 30),
    voteSeconds: Number(session?.resolved_timing?.twoTruths?.voteSeconds || 20),
    gameStatus: 'waiting',
  };
  const submitSeconds = Math.max(5, Number(base.submitSeconds || session?.resolved_timing?.twoTruths?.submitSeconds || 30));
  const voteSeconds = Math.max(5, Number(base.voteSeconds || session?.resolved_timing?.twoTruths?.voteSeconds || 20));

  if (actionType === 'two_truths:start') {
    if (base.phase !== 'waiting' && base.phase !== 'results') return base;
    return {
      ...base,
      phase: 'submit',
      presenterParticipantId: participantId,
      totalRounds: base.totalRounds,
      statements: null,
      votes: {},
      revealedLie: null,
      correctLieId: undefined,
      submitSeconds,
      voteSeconds,
      submitEndsAt: new Date(Date.now() + submitSeconds * 1000).toISOString(),
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'two_truths:submit') {
    if (base.phase !== 'submit') return base;
    // Only the designated presenter may submit (UI already hides the form; enforce on server).
    if (!base.presenterParticipantId || participantId !== base.presenterParticipantId) return base;
    const statements: string[] = Array.isArray(payload?.statements) ? payload.statements : [];
    if (statements.length < 3) return base;

    const rawLieIndex = Number(payload?.lieIndex);
    const lieIndex =
      Number.isFinite(rawLieIndex) && Number.isInteger(rawLieIndex) && rawLieIndex >= 0 && rawLieIndex <= 2
        ? rawLieIndex
        : 2;

    const rawStatementsWithLabels = [
      { text: String(statements[0] || '').slice(0, 300), isLie: lieIndex === 0 },
      { text: String(statements[1] || '').slice(0, 300), isLie: lieIndex === 1 },
      { text: String(statements[2] || '').slice(0, 300), isLie: lieIndex === 2 },
    ];

    const shuffled = shuffleArray(rawStatementsWithLabels);
    let correctLieId: 's0' | 's1' | 's2' = 's2';

    const normalized = shuffled.map((s, i) => {
      const id = `s${i}` as 's0' | 's1' | 's2';
      if (s.isLie) correctLieId = id;
      return { id, text: s.text };
    });

    const ready = normalized.every((s) => s.text.trim().length > 0);
    if (!ready) return base;

    return {
      ...base,
      phase: 'vote',
      presenterParticipantId: participantId,
      statements: normalized,
      votes: {},
      revealedLie: null,
      correctLieId,
      submitSeconds,
      voteSeconds,
      voteEndsAt: new Date(Date.now() + voteSeconds * 1000).toISOString(),
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'two_truths:vote') {
    if (base.phase !== 'vote') return base;
    const choice = payload?.statementId;
    if (!['s0', 's1', 's2'].includes(choice)) return base;
    if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;

    try {
      const roundIdForVote = activeRoundId || null;
      if (!session?.id || !roundIdForVote) {
        throw new Error('Cannot record vote: missing session or active round');
      }
      const voteResult = await query<{ statement_id: string }>(
        `INSERT INTO game_votes (game_session_id, round_id, participant_id, statement_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (game_session_id, round_id, participant_id)
         DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()
         RETURNING statement_id`,
        [session.id, roundIdForVote, participantId, choice]
      );

      if (!voteResult?.[0]) {
        throw new Error('Vote insertion returned no result - database write failed');
      }

      console.log('[TwoTruths] Atomic vote recorded successfully', {
        sessionId: session?.id,
        participantId,
        choice,
        dbConfirmed: true,
      });
    } catch (err: any) {
      console.error('[TwoTruths] CRITICAL: Failed to record vote atomically', {
        sessionId: session?.id,
        participantId,
        choice,
        error: err?.message,
        stack: err?.stack,
      });
      throw new Error('Failed to record your vote. Please try voting again.');
    }

    return { ...base, votes: { ...base.votes, [participantId]: choice } };
  }

  if (actionType === 'two_truths:reveal') {
    if (base.phase !== 'vote') return base;
    if (!base.presenterParticipantId || participantId !== base.presenterParticipantId) {
      throw new Error('Only the person who submitted these statements can reveal the answer.');
    }
    const needRow = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM participants p
       WHERE p.event_id = $1 AND p.left_at IS NULL
         AND p.id <> $2`,
      [eventId, base.presenterParticipantId],
    );
    const expectedVoters = Number(needRow?.c ?? 0);
    const votedCount = Object.keys(base.votes).length;
    if (expectedVoters > 0 && votedCount < expectedVoters) {
      throw new Error(
        `All players must vote before you reveal (${votedCount}/${expectedVoters} votes in).`,
      );
    }
    const lie: 's0' | 's1' | 's2' =
      base.correctLieId || (['s0', 's1', 's2'].includes(payload?.lieId) ? payload.lieId : 's2');

    const updatedScores = { ...base.scores };
    for (const [voterId, vote] of Object.entries(base.votes)) {
      if (vote === lie) {
        updatedScores[voterId] = (updatedScores[voterId] || 0) + 100;
      }
    }

    return {
      ...base,
      phase: 'reveal',
      revealedLie: lie,
      scores: updatedScores,
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'two_truths:next_round') {
    if (base.phase !== 'reveal') return base;
    if (!base.presenterParticipantId || participantId !== base.presenterParticipantId) {
      throw new Error('Only the person who led this round can go to the next round.');
    }
    const nextRound = (base.round ?? 1) + 1;
    const totalRounds = base.totalRounds ?? 4;
    if (nextRound > totalRounds) {
      return { ...base, phase: 'results', gameStatus: 'finished' };
    }

    const row = await queryOne<{ next_id: string }>(
      `WITH ordered AS (
         SELECT p.id,
                LEAD(p.id) OVER (ORDER BY p.created_at ASC) AS next_id
         FROM participants p
         WHERE p.event_id = $1 AND p.left_at IS NULL
       )
       SELECT COALESCE(
         (SELECT next_id FROM ordered WHERE id = $2),
         (SELECT id FROM participants WHERE event_id = $1 AND left_at IS NULL ORDER BY created_at ASC LIMIT 1)
       ) AS next_id`,
      [eventId, base.presenterParticipantId || participantId]
    );

    return {
      ...base,
      round: nextRound,
      phase: 'submit',
      presenterParticipantId: row?.next_id || null,
      statements: null,
      votes: {},
      revealedLie: null,
      correctLieId: undefined,
      submitSeconds,
      voteSeconds,
      submitEndsAt: new Date(Date.now() + submitSeconds * 1000).toISOString(),
    };
  }

  return base;
}
