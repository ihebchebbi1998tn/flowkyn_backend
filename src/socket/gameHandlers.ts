/**
 * Game namespace handlers — sessions, rounds, actions with DB persistence.
 */
import { Namespace } from 'socket.io';
import { z } from 'zod';
import { AuthenticatedSocket } from './types';
import { GamesService } from '../services/games.service';
import { CoffeeRouletteConfigService } from '../services/coffeeRouletteConfig.service';
import { query, queryOne, transaction } from '../config/database';
import crypto from 'crypto';

const gamesService = new GamesService();
const coffeeService = new CoffeeRouletteConfigService();

function toSnapshotCreatedAt(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}
// Zod schemas for game socket events
const gameJoinSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

const gameRoundSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

const gameRoundNumberSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundNumber: z.number().int().min(1, 'Invalid round number'),
});

const gameActionSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundId: z.string().uuid('Invalid round ID').optional(),
  // Allow simple keys plus colon separators so actions like "two_truths:start" are valid.
  actionType: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_:-]+$/, 'Invalid action type'),
  payload: z
    .record(z.unknown())
    .refine(
      (val) => JSON.stringify(val).length <= 10000,
      { message: 'Payload too large (max 10KB)' }
    )
    .optional(),
});

const gameRoundEndSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundId: z.string().uuid('Invalid round ID'),
});

const gameEndSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

const gameStateSyncSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

// ─── Coffee Roulette Voice (WebRTC signaling) ───
const coffeeVoiceOfferSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  // Pair id generated during `coffee:shuffle` and stored in the coffee snapshot.
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(1)
    .max(200000, 'SDP too large'),
});

const coffeeVoiceAnswerSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(1)
    .max(200000, 'SDP too large'),
});

const coffeeVoiceIceCandidateSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  candidate: z
    .object({
      candidate: z.string().max(20000),
      sdpMid: z.string().nullable(),
      sdpMLineIndex: z.number().int().nullable(),
      usernameFragment: z.string().nullable().optional(),
    })
    .strict(),
});

const coffeeVoiceRequestOfferSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
});

const coffeeVoiceHangupSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
});

function isTwoTruthsAction(actionType: string) {
  return actionType.startsWith('two_truths:');
}

function isCoffeeAction(actionType: string) {
  return actionType.startsWith('coffee:');
}

function isStrategicAction(actionType: string) {
  // Future-proofing: only allow known strategic actions to update snapshots.
  // Unknown strategic:* actions should NOT be persisted, to avoid accidentally
  // creating a default state that overwrites a configured scenario.
  return (
    actionType === 'strategic:configure' ||
    actionType === 'strategic:assign_roles' ||
    actionType === 'strategic:start_discussion' ||
    actionType === 'strategic:end_discussion'
  );
}

async function getSessionGameKey(sessionId: string): Promise<string | null> {
  const row = await queryOne<{ key: string }>(
    `SELECT gt.key
     FROM game_sessions gs
     JOIN game_types gt ON gt.id = gs.game_type_id
     WHERE gs.id = $1`,
    [sessionId]
  );
  return row?.key || null;
}

type TwoTruthsState = {
  kind: 'two-truths';
  phase: 'waiting' | 'submit' | 'vote' | 'reveal' | 'results';
  round: number;
  totalRounds: number;
  presenterParticipantId: string | null;
  statements: { id: 's0' | 's1' | 's2'; text: string }[] | null;
  votes: Record<string, 's0' | 's1' | 's2'>;
  revealedLie: 's0' | 's1' | 's2' | null;
  correctLieId?: 's0' | 's1' | 's2'; // Internal secret
  scores: Record<string, number>;
  submitEndsAt?: string;
  voteEndsAt?: string;
  submitSeconds?: number;
  voteSeconds?: number;
  /** FIX #1: Track game status for consistency */
  gameStatus?: 'waiting' | 'in_progress' | 'finished';
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function reduceTwoTruthsState(args: {
  eventId: string;
  sessionId?: string;
  participantId: string;
  actionType: string;
  payload: any;
  prev: TwoTruthsState | null;
  session?: any;
}): Promise<TwoTruthsState> {
  const { eventId, sessionId, participantId, actionType, payload, prev, session } = args;

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
    return {
      ...base,
      phase: 'submit',
      presenterParticipantId: participantId,
      // Source of truth: totalRounds configured when the session was created
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
    // Guard: only accept submissions during submit phase
    if (base.phase !== 'submit') return base;
    const statements: string[] = Array.isArray(payload?.statements) ? payload.statements : [];
    if (statements.length < 3) return base;

    // The original logic assumed index 2 is the lie.
    // We now allow the presenter to explicitly choose which index is the lie (0..2).
    const rawLieIndex = Number(payload?.lieIndex);
    const lieIndex =
      Number.isFinite(rawLieIndex) && Number.isInteger(rawLieIndex) && rawLieIndex >= 0 && rawLieIndex <= 2
        ? rawLieIndex
        : 2;

    // We shuffle them but keep track of which one was the lie.
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

    const ready = normalized.every(s => s.text.trim().length > 0);
    if (!ready) return base;

    return {
      ...base,
      phase: 'vote',
      presenterParticipantId: participantId,
      statements: normalized,
      votes: {},
      revealedLie: null,
      correctLieId, // Store this securely in the snapshot
      submitSeconds,
      voteSeconds,
      voteEndsAt: new Date(Date.now() + voteSeconds * 1000).toISOString(),
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'two_truths:vote') {
    // Guard: only accept votes during vote phase
    if (base.phase !== 'vote') return base;
    const choice = payload?.statementId;
    if (!['s0', 's1', 's2'].includes(choice)) return base;
    if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;
    
    // FIX #4: Atomic vote recording - use database INSERT with unique constraint
    // instead of in-memory votes object to prevent race conditions
    try {
      // This will use the unique constraint to prevent duplicate votes
      // and atomic INSERT ensures only one vote per participant
      await query(
        `INSERT INTO game_votes (game_session_id, participant_id, statement_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (game_session_id, participant_id) 
         DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()`,
        [session?.id, participantId, choice]
      );
      console.log('[TwoTruths] Atomic vote recorded', { sessionId: session?.id, participantId, choice });
    } catch (err) {
      console.warn('[TwoTruths] Failed to record vote atomically', { participantId, error: err });
      // Fall back to in-memory update if DB fails
    }
    
    return { ...base, votes: { ...base.votes, [participantId]: choice } };
  }

  if (actionType === 'two_truths:reveal') {
    // Priority: 
    // 1. correctLieId stored in snapshot during submit phase
    // 2. lieId provided by host in payload (legacy/fallback)
    // 3. s2 (default)
    const lie: 's0' | 's1' | 's2' = base.correctLieId || 
      (['s0', 's1', 's2'].includes(payload?.lieId) ? payload.lieId : 's2');
    
    // Calculate new scores
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
    const nextRound = base.round + 1;
    if (nextRound > base.totalRounds) return { ...base, phase: 'results', gameStatus: 'finished' };

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

type CoffeeState = {
  kind: 'coffee-roulette';
  phase: 'waiting' | 'matching' | 'chatting' | 'complete';
  gameStatus?: 'waiting' | 'in_progress' | 'finished'; // FIX #2: Explicit game status
  configId?: string; // ID of the coffee roulette configuration for this event
  pairs: Array<{
    id: string;
    person1: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    person2: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    topic: string;
    topicKey?: string; // i18n key (used for fallback topics so all clients can translate locally)
    topicId?: string; // ID of the selected topic
    sessionId?: string; // Pair session ID for tracking
  }>;
  startedChatAt: string | null;
  chatEndsAt?: string;
  chatDurationMinutes?: number;
  /** Number of conversation prompts used in the current chat session */
  promptsUsed: number;
  /** When true, clients should ask whether to continue or end */
  decisionRequired: boolean;
  /** Track questions used in session */
  usedQuestionIndices?: number[];
  /** FIX #6: Participants who couldn't be paired (odd count) */
  unpairedParticipantIds?: string[];
};

/**
 * Get dynamic topic from Coffee Roulette configuration for an event.
 * Falls back to fallback topic if no configuration exists.
 */
async function getDynamicTopic(eventId: string): Promise<{ text: string; id?: string }> {
  try {
    // Get configuration for the event
    const config = await queryOne(
      'SELECT id FROM coffee_roulette_config WHERE event_id = $1',
      [eventId]
    );

    if (config) {
      // Use service to select topic based on configuration strategy
      const selectedTopic = await coffeeService.selectTopic(config.id);
      if (selectedTopic) {
        return {
          text: selectedTopic.title || 'gamePlay.coffeeRoulette.defaultTopic',
          id: selectedTopic.id,
        };
      }
    }
  } catch (error) {
    console.error('Error selecting dynamic topic:', error);
  }

  // Fallback to default topics if no configuration or selection failed
  const FALLBACK_TOPIC_KEYS = [
    'gamePlay.coffeeRoulette.fallbackTopics.t1',
    'gamePlay.coffeeRoulette.fallbackTopics.t2',
    'gamePlay.coffeeRoulette.fallbackTopics.t3',
    'gamePlay.coffeeRoulette.fallbackTopics.t4',
    'gamePlay.coffeeRoulette.fallbackTopics.t5',
    'gamePlay.coffeeRoulette.fallbackTopics.t6',
    'gamePlay.coffeeRoulette.fallbackTopics.t7',
    'gamePlay.coffeeRoulette.fallbackTopics.t8',
    'gamePlay.coffeeRoulette.fallbackTopics.t9',
    'gamePlay.coffeeRoulette.fallbackTopics.t10',
    'gamePlay.coffeeRoulette.fallbackTopics.t11',
  ];

  const randomKey = FALLBACK_TOPIC_KEYS[Math.floor(Math.random() * FALLBACK_TOPIC_KEYS.length)];
  // We also set `text` to the key for backward-compat if a client doesn't support topicKey translation.
  return { text: randomKey, id: undefined };
}

async function reduceCoffeeState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: CoffeeState | null;
  session?: any;
}): Promise<CoffeeState> {
  const { eventId, actionType, payload, prev, session } = args;

  const base: CoffeeState = prev || {
    kind: 'coffee-roulette',
    phase: 'waiting',
    gameStatus: 'waiting', // FIX #2: Add game status
    pairs: [],
    startedChatAt: null,
    chatDurationMinutes: Math.max(1, Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || 30)),
    promptsUsed: 0,
    decisionRequired: false,
  };

  if (actionType === 'coffee:shuffle') {
    // Get configuration ID for the event.
    // NOTE: This must be resilient even if the coffee_roulette_config table
    // doesn't exist yet (e.g. migrations not applied). In that case we
    // gracefully fallback to default topics.
    let configRow: { id: string } | null = null;
    try {
      configRow = await queryOne(
        'SELECT id FROM coffee_roulette_config WHERE event_id = $1',
        [eventId]
      );
    } catch (err: any) {
      console.error('[CoffeeRoulette] Missing coffee_roulette_config table or failed query.', {
        eventId,
        error: err?.message || err,
      });
      configRow = null;
    }

    const participants = await query<{ id: string; name: string; avatar: string | null }>(
      `SELECT p.id,
              COALESCE(ep.display_name, u.name, p.guest_name, 'Unknown') AS name,
              COALESCE(ep.avatar_url, u.avatar_url, p.guest_avatar) AS avatar
       FROM participants p
       LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
       LEFT JOIN organization_members om ON om.id = p.organization_member_id
       LEFT JOIN users u ON u.id = om.user_id
       WHERE p.event_id = $1 AND p.left_at IS NULL
       ORDER BY p.created_at ASC`,
      [eventId]
    );

    // Participants returned by the DB query are already unique by `p.id`.
    // We must not dedupe by `name+avatar`, otherwise two different people
    // with the same display name/avatar can be incorrectly merged, breaking
    // matching/chat sync correctness.
    const uniqueParticipants = participants;

    // Guard: need at least 2 participants to form pairs
    if (uniqueParticipants.length < 2) {
      return { ...base, phase: 'waiting', pairs: [], startedChatAt: null };
    }

    // Fisher-Yates shuffle for unbiased randomisation
    const shuffled = [...uniqueParticipants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Sync requirement:
    // Pick ONE topic per shuffle so every pair (and both talkers) sees the same
    // "Today's Topic" at the same prompt index.
    const topicData = await getDynamicTopic(eventId);
    const topicKey = topicData.text.startsWith('gamePlay.coffeeRoulette.') ? topicData.text : undefined;

    // FIX #6: Handle odd participants explicitly instead of silently omitting them
    const pairs: CoffeeState['pairs'] = [];
    const unpairedParticipants: string[] = [];
    
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) {
        // Odd participant: track as unpaired for next round
        unpairedParticipants.push(shuffled[i].id);
        break;
      }
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      const pairId = crypto.randomUUID();

      pairs.push({
        id: pairId,
        person1: { participantId: p1.id, name: p1.name, avatar: (p1.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p1.avatar || null },
        person2: { participantId: p2.id, name: p2.name, avatar: (p2.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p2.avatar || null },
        topic: topicData.text,
        topicKey,
        topicId: topicData.id,
      });
    }

    // If there are unpaired participants, record them in the database for awareness
    if (unpairedParticipants.length > 0) {
      try {
        for (const participantId of unpairedParticipants) {
          await query(
            `INSERT INTO coffee_roulette_unpaired (game_session_id, participant_id, reason)
             VALUES ($1, $2, 'odd_count')
             ON CONFLICT (game_session_id, participant_id) DO UPDATE
             SET resolved_at = NULL`,
            [session.id, participantId]
          );
        }
      } catch (err) {
        console.warn('[CoffeeRoulette] Failed to record unpaired participants', { eventId, error: err });
      }
    }

    return {
      ...base,
      configId: configRow?.id,
      phase: 'matching',
      gameStatus: 'in_progress', // FIX #2: Game has started
      pairs,
      startedChatAt: null,
      chatDurationMinutes: Math.max(1, Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || base.chatDurationMinutes || 30)),
      promptsUsed: 0,
      decisionRequired: false,
      // FIX #6: Notify clients about unpaired participants if any
      unpairedParticipantIds: unpairedParticipants.length > 0 ? unpairedParticipants : undefined,
    };
  }

  if (actionType === 'coffee:start_chat') {
    // Idempotent: if chat already started, ignore duplicates (prevents timer resets
    // when multiple clients emit automatically on 'matching').
    if (base.startedChatAt) return base;
    // Safety: chat cannot start without at least one pair.
    if (!Array.isArray(base.pairs) || base.pairs.length === 0) {
      console.warn('[CoffeeRoulette] Ignoring coffee:start_chat without pairs', {
        eventId,
        phase: base.phase,
      });
      return { ...base, phase: 'waiting', startedChatAt: null };
    }
    const chatDurationMinutes = Math.max(1, Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || 30));
    return { 
      ...base, 
      phase: 'chatting',
      gameStatus: 'in_progress', // FIX #2: Game is in progress 
      startedChatAt: new Date().toISOString(),
      chatDurationMinutes,
      chatEndsAt: new Date(Date.now() + chatDurationMinutes * 60000).toISOString(),
      // Start with 1 prompt already assigned on shuffle
      promptsUsed: Math.max(1, base.promptsUsed || 0),
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:next_prompt') {
    // Only relevant during an active chat
    if (base.phase !== 'chatting') return base;

    // Prevent stale "next prompt" actions from desyncing state.
    const expectedPromptsUsed = payload?.expectedPromptsUsed;
    if (typeof expectedPromptsUsed === 'number' && expectedPromptsUsed !== base.promptsUsed) {
      console.warn('[CoffeeRoulette] Ignoring stale coffee:next_prompt', {
        eventId,
        expectedPromptsUsed,
        serverPromptsUsed: base.promptsUsed,
        phase: base.phase,
      });
      return base;
    }

    const nextPromptsUsed = (base.promptsUsed || 0) + 1;
    const shouldAsk = nextPromptsUsed >= 6;

    // Sync requirement:
    // Pick ONE topic for the whole session/prompt index (not one per pair).
    const nextTopicData = await getDynamicTopic(eventId);
    const nextTopicKey = nextTopicData.text.startsWith('gamePlay.coffeeRoulette.') ? nextTopicData.text : undefined;
    const updatedPairs = (base.pairs || []).map((pair) => ({
      ...pair,
      topic: nextTopicData.text,
      topicKey: nextTopicKey,
      topicId: nextTopicData.id,
    }));

    return {
      ...base,
      pairs: updatedPairs,
      promptsUsed: nextPromptsUsed,
      decisionRequired: shouldAsk,
    };
  }

  if (actionType === 'coffee:continue') {
    // Host/any participant chooses to continue; reset the counter and keep chatting
    if (base.phase !== 'chatting') return base;

    // Prevent stale "continue" actions from desyncing state.
    const expectedPromptsUsed = payload?.expectedPromptsUsed;
    if (typeof expectedPromptsUsed === 'number' && expectedPromptsUsed !== base.promptsUsed) {
      console.warn('[CoffeeRoulette] Ignoring stale coffee:continue', {
        eventId,
        expectedPromptsUsed,
        serverPromptsUsed: base.promptsUsed,
        phase: base.phase,
      });
      return base;
    }

    return {
      ...base,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:end') {
    return { ...base, phase: 'complete', gameStatus: 'finished' }; // FIX #2: Game finished
  }

  if (actionType === 'coffee:end_and_finish') {
    return { ...base, phase: 'complete', gameStatus: 'finished' }; // FIX #2: Game finished
  }

  if (actionType === 'coffee:reset') {
    return {
      kind: 'coffee-roulette',
      phase: 'waiting',
      gameStatus: 'waiting', // FIX #2: Reset to waiting
      pairs: [],
      startedChatAt: null,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  return base;
}

type StrategicState = {
  kind: 'strategic-escape';
  phase: 'setup' | 'roles_assignment' | 'pre_discussion' | 'discussion' | 'debrief';
  // Stable keys (preferred)
  industryKey: string | null;
  crisisKey: string | null;
  difficultyKey: 'easy' | 'medium' | 'hard';
  // Display labels (for UI/emails)
  industryLabel: string;
  crisisLabel: string;
  difficultyLabel: string;
  rolesAssigned: boolean;
  discussionDurationMinutes?: number;
  discussionEndsAt?: string;
  /** FIX #1: Track game status for consistency */
  gameStatus?: 'waiting' | 'in_progress' | 'finished';
};

async function reduceStrategicState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: StrategicState | null;
  session?: any;
}): Promise<StrategicState> {
  const { actionType, payload, prev, session } = args;

  const base: StrategicState = prev || {
    kind: 'strategic-escape',
    phase: 'setup',
    industryKey: payload?.industryKey || null,
    crisisKey: payload?.crisisKey || null,
    difficultyKey: (payload?.difficultyKey || payload?.difficulty || 'medium'),
    industryLabel: payload?.industryLabel || payload?.industry || 'General',
    crisisLabel: payload?.crisisLabel || payload?.crisisType || 'Scenario',
    difficultyLabel: payload?.difficultyLabel || payload?.difficulty || 'medium',
    rolesAssigned: false,
    discussionDurationMinutes: Math.max(1, Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes || 45)),
    gameStatus: 'waiting',
  };

  if (actionType === 'strategic:configure') {
    return {
      ...base,
      industryKey: payload?.industryKey ?? base.industryKey,
      crisisKey: payload?.crisisKey ?? base.crisisKey,
      difficultyKey: (payload?.difficultyKey || payload?.difficulty || base.difficultyKey),
      industryLabel: payload?.industryLabel || payload?.industry || base.industryLabel,
      crisisLabel: payload?.crisisLabel || payload?.crisisType || base.crisisLabel,
      difficultyLabel: payload?.difficultyLabel || payload?.difficulty || base.difficultyLabel,
      phase: 'setup',
      gameStatus: 'waiting',
    };
  }

  if (actionType === 'strategic:assign_roles') {
    // Idempotent: don't re-run assignment transitions
    if (base.rolesAssigned) return base;
    return {
      ...base,
      rolesAssigned: true,
      phase: 'roles_assignment',
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'strategic:start_discussion') {
    // Idempotent: don't reset discussion timer if already started
    if (base.phase === 'discussion' && base.discussionEndsAt) return base;
    const minutes = typeof payload?.durationMinutes === 'number'
      ? payload.durationMinutes
      : Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes || 45);
    return {
      ...base,
      phase: 'discussion',
      discussionDurationMinutes: Math.max(1, Number(minutes || base.discussionDurationMinutes || 45)),
      discussionEndsAt: new Date(Date.now() + minutes * 60000).toISOString(),
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'strategic:end_discussion') {
    // Idempotent: repeated end should not change anything
    if (base.phase === 'debrief') return base;
    return {
      ...base,
      phase: 'debrief',
      gameStatus: 'finished',
    };
  }

  return base;
}

/** Verify the user is a participant in the game session's event and return their participant ID */
async function verifyGameParticipant(sessionId: string, userId: string, socket?: AuthenticatedSocket): Promise<{ participantId: string } | null> {
  // If this is a guest socket, use the guest payload directly
  if (socket?.isGuest && socket.guestPayload) {
    let guestRow = await queryOne<{ id: string }>(
      `SELECT p.id FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [sessionId, socket.guestPayload.participantId]
    );
    
    if (guestRow) {
      return { participantId: guestRow.id };
    }
    
    console.warn('[Games] Direct participant verification FAILED: participant not found in session', {
      sessionId: sessionId.substring(0, 8) + '...',
      participantIdFromToken: socket.guestPayload.participantId?.substring(0, 8) + '...',
      socketId: socket.id,
    });
    
    // Reload/self-heal fallback: recover by stable guest_identity_key when token participantId is stale.
    if (!socket.guestPayload.guestIdentityKey) {
      console.warn('[Games] Recovery BLOCKED: no identity key in guest payload', {
        sessionId: sessionId.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }
    
    guestRow = await queryOne<{ id: string }>(
      `SELECT p.id
       FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [sessionId, socket.guestPayload.guestIdentityKey]
    );
    
    if (guestRow) {
      socket.guestPayload.participantId = guestRow.id;
      return { participantId: guestRow.id };
    }
    
    console.error('[Games] Fallback recovery FAILED: no participant found with identity key', {
      sessionId: sessionId.substring(0, 8) + '...',
      identityKeyPrefix: socket.guestPayload.guestIdentityKey.substring(0, 8) + '...',
      socketId: socket.id,
    });
    return null;
  }

  // Recovery mode: token may be missing/expired, recover guest by stable identity key.
  if (socket?.isGuestByKey && typeof socket?.handshake?.auth?.guestIdentityKey === 'string') {
    const recoveryEventId = typeof socket.handshake.auth.eventId === 'string' ? socket.handshake.auth.eventId : '';
    const recoveryKey = socket.handshake.auth.guestIdentityKey;
    
    if (!recoveryEventId) {
      console.warn('[Games] Guest recovery blocked: missing eventId', { sessionId: sessionId.substring(0, 8) + '...' });
      return null;
    }

    const guestRow = await queryOne<{ id: string; event_id: string; guest_name: string | null }>(
      `SELECT p.id, p.event_id, p.guest_name
       FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [sessionId, recoveryKey]
    );
    
    if (!guestRow) {
      console.warn('[Games] Guest recovery FAILED: no participant found', {
        sessionId: sessionId.substring(0, 8) + '...',
        recoveryKey: recoveryKey.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }
    
    if (guestRow.event_id !== recoveryEventId) {
      console.warn('[Games] Guest recovery FAILED: eventId mismatch', {
        recoveryEventId: recoveryEventId.substring(0, 8) + '...',
        foundEventId: guestRow.event_id.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }

    // Upgrade socket to normal guest mode for all future operations.
    socket.guestPayload = {
      participantId: guestRow.id,
      eventId: guestRow.event_id,
      guestName: guestRow.guest_name || 'Guest',
      guestIdentityKey: recoveryKey,
      isGuest: true,
    };
    socket.isGuest = true;
    socket.isGuestByKey = false;
    socket.user = { userId: `guest:${guestRow.id}`, email: '' };

    return { participantId: guestRow.id };
  }

  // Authenticated user: match via organization_members
  const row = await queryOne<{ id: string }>(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN game_sessions gs ON gs.event_id = p.event_id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending') AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1`,
    [sessionId, userId]
  );
  if (row) return { participantId: row.id };

  // FIX: Auto-join them to participants if they are an active org member.
  const orgMember = await queryOne<{ id: string; event_id: string }>(
    `SELECT om.id, gs.event_id
     FROM organization_members om
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [sessionId, userId]
  );

  if (orgMember) {
    const participantId = crypto.randomUUID();
    // Use an UPSERT-like approach or handle conflict if a unique constraint exists, 
    // but the safest generic way without relying on a strict DB schema constraint 
    // (since organization_member_id + event_id isn't always strictly unique at DB level) 
    // is to use a transaction or an INSERT ... ON CONFLICT if the constraint exists.
    // Assuming a unique constraint might not exist, we'll do an idempotent insert using a CTE.
    const result = await query(
      `WITH existing AS (
         SELECT id FROM participants 
         WHERE event_id = $2 AND organization_member_id = $3 AND left_at IS NULL
       ),
       inserted AS (
         INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
         SELECT $1, $2, $3, 'member', NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1`,
      [participantId, orgMember.event_id, orgMember.id]
    );
    
    return { participantId: result[0]?.id || participantId };
  }

  return null;
}

/** Check if user can control game flow (org admin/moderator/owner OR event creator/host). */
async function isEventAdmin(sessionId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ role_name: string; member_id: string; created_by_member_id: string }>(
    `SELECT r.name as role_name, om.id as member_id, e.created_by_member_id
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [sessionId, userId]
  );
  if (!row) return false;
  return ['owner', 'admin', 'moderator'].includes(row.role_name) || row.member_id === row.created_by_member_id;
}

async function allowParticipantGameControlForSession(sessionId: string): Promise<boolean> {
  const row = await queryOne<{ allow: boolean }>(
    `SELECT COALESCE(es.allow_participant_game_control, true) as allow
     FROM game_sessions gs
     LEFT JOIN event_settings es ON es.event_id = gs.event_id
     WHERE gs.id = $1`,
    [sessionId]
  );
  return row ? !!row.allow : true;
}

/**
 * When allow_participant_game_control=true for the event, any verified participant (including guests)
 * can perform actions that are otherwise restricted to admins/moderators.
 */
async function canControlGameFlow(sessionId: string, userId: string, socket: AuthenticatedSocket): Promise<boolean> {
  if (!(await allowParticipantGameControlForSession(sessionId))) {
    return isEventAdmin(sessionId, userId);
  }
  const participant = await verifyGameParticipant(sessionId, userId, socket);
  return !!participant;
}

export function setupGameHandlers(gamesNs: Namespace) {
  // Used for targeted forwarding of WebRTC signaling messages (no media relay through backend).
  // key: `${sessionId}:${participantId}` -> socket.id
  const voiceSocketByKey = new Map<string, string>();
  // socket.id -> Set<key>
  const voiceKeysBySocket = new Map<string, Set<string>>();
  // coffee voice offer cache for late joiners:
  // key: `${sessionId}:${pairId}` -> { sdp, fromParticipantId, createdAt }
  const coffeeVoiceOfferCache = new Map<string, { sdp: string; fromParticipantId: string; createdAt: number }>();
  const COFFEE_VOICE_OFFER_TTL_MS = 35 * 60 * 1000; // ~chat duration; prevent cache buildup

  // Serialize Coffee Roulette snapshot transitions per session.
  // Prevents concurrent next_prompt/continue requests from racing on stale snapshots.
  const coffeeActionQueue = new Map<string, Promise<void>>();

  gamesNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;

    const joinedSessions = new Set<string>();
    // Track participant IDs per joined session so disconnect cleanup can soft-delete correctly.
    const joinedParticipantBySessionId = new Map<string, string>();

    // ─── Join game session room ───
    socket.on('game:join', async (data: { sessionId: string }, ack) => {
      const validation = gameJoinSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        ack?.({
          ok: false,
          error: 'Invalid session ID',
          code: 'VALIDATION',
          details: { issue: validation.error.issues[0] },
        });
        return;
      }

      try {
        // BUG FIX: Verify user is a participant in the event before joining
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          ack?.({
            ok: false,
            error: 'Not a participant',
            code: 'FORBIDDEN',
            details: { isGuest: !!socket.isGuest, userId: user.userId, sessionId: data.sessionId },
          });
          return;
        }

        const [session, activeRound, snapshotRaw, admin] = await Promise.all([
          gamesService.getSession(data.sessionId),
          gamesService.getActiveRound(data.sessionId),
          gamesService.getLatestSnapshot(data.sessionId),
          canControlGameFlow(data.sessionId, user.userId, socket).catch(() => false),
        ]);
        let snapshot = snapshotRaw;

        // Backfill legacy Coffee Roulette sessions that were created before
        // initial snapshot bootstrapping was added.
        if (!snapshot) {
          const typeRow = await queryOne<{ key: string }>(
            `SELECT gt.key
             FROM game_sessions gs
             JOIN game_types gt ON gt.id = gs.game_type_id
             WHERE gs.id = $1`,
            [data.sessionId],
          );
          if (typeRow?.key === 'coffee-roulette') {
            const state = {
              kind: 'coffee-roulette',
              phase: 'waiting',
              pairs: [],
              startedChatAt: null,
              promptsUsed: 0,
              decisionRequired: false,
            };
            snapshot = await gamesService.saveSnapshot(data.sessionId, state);
          }
        }
        const roomId = `game:${data.sessionId}`;
        socket.join(roomId);
        joinedSessions.add(data.sessionId);
        joinedParticipantBySessionId.set(data.sessionId, participant.participantId);

        console.log('[Games] User joined game session', {
          socketId: socket.id,
          sessionId: data.sessionId,
          roomId,
          participantId: participant.participantId,
          userId: user.userId,
        });

        // Register socket mapping for targeted voice signaling.
        // This is needed because `coffee:voice_*` events must be forwarded only to the paired participant.
        const voiceKey = `${data.sessionId}:${participant.participantId}`;
        voiceSocketByKey.set(voiceKey, socket.id);
        const existing = voiceKeysBySocket.get(socket.id) ?? new Set<string>();
        existing.add(voiceKey);
        voiceKeysBySocket.set(socket.id, existing);

        // Notify others
        socket.to(roomId).emit('game:player_joined', {
          userId: user.userId,
          participantId: participant.participantId,
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

          // FIX #1: Enrich snapshot with current pair info for late joiners
          const enrichedSnapshot = snapshot?.state;
          if (enrichedSnapshot && (enrichedSnapshot as any).kind === 'coffee-roulette' && (enrichedSnapshot as any).pairs) {
            // Ensure pairs are properly formatted and include all necessary info
            const pairs = (enrichedSnapshot as any).pairs;
            (enrichedSnapshot as any).pairs = pairs.map((p: any) => ({
              id: p.id,
              person1: p.person1,
              person2: p.person2,
              topic: p.topic,
              topicKey: p.topicKey,
              topicId: p.topicId,
            }));
          }

          ack?.({
            ok: true,
            data: {
              status: session.status,
              currentRound: session.current_round,
              totalRounds: session.total_rounds || 4,
              activeRoundId: activeRound?.id || null,
              participantId: participant.participantId,
              snapshot: enrichedSnapshot || null,
              snapshotRevisionId: snapshot?.id || null,
              snapshotCreatedAt: toSnapshotCreatedAt(snapshot?.created_at),
              sessionDeadlineAt: (session as any)?.session_deadline_at || null,
              resolvedTiming: (session as any)?.resolved_timing || null,
              // "Admin" here means "can control game flow" for UI purposes.
              isAdmin: !!admin,
            },
          });
      } catch (err: any) {
        console.error(`[Games] game:join error:`, err.message);
        socket.emit('error', { message: err.message, code: 'JOIN_ERROR' });
        ack?.({
          ok: false,
          error: err.message,
          code: 'JOIN_ERROR',
          details: { message: err?.message || String(err) },
        });
      }
    });

    // ─── Leave game session ───
    socket.on('game:leave', (data: { sessionId: string }) => {
      const validation = gameRoundSchema.safeParse(data);
      if (!validation.success) return;
      const roomId = `game:${data.sessionId}`;
      socket.leave(roomId);
      joinedSessions.delete(data.sessionId);
      joinedParticipantBySessionId.delete(data.sessionId);

      // Remove any voice keys associated with this session for this socket.
      const keys = voiceKeysBySocket.get(socket.id);
      if (keys) {
        for (const key of Array.from(keys)) {
          if (key.startsWith(`${data.sessionId}:`)) {
            voiceSocketByKey.delete(key);
            keys.delete(key);
          }
        }
        if (keys.size === 0) voiceKeysBySocket.delete(socket.id);
      }

      socket.to(roomId).emit('game:player_left', {
        userId: user.userId,
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── Start game (only admins/moderators) ───
    socket.on('game:start', async (data: { sessionId: string }) => {
      const validation = gameRoundSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
        if (!ok) {
          socket.emit('error', { message: 'Only event administrators can start games', code: 'FORBIDDEN' });
          return;
        }

        const round = await gamesService.startRound(data.sessionId);

        gamesNs.to(`game:${data.sessionId}`).emit('game:started', {
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_started', {
          sessionId: data.sessionId,
          roundId: round.id,
          roundNumber: round.round_number,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error(`[Games] game:start error:`, err.message);
        socket.emit('error', { message: err.message, code: 'START_ERROR' });
      }
    });

    // ─── Start next round (only admins/moderators) ───
    socket.on('game:round_start', async (data: { sessionId: string; roundNumber: number }) => {
      const validation = gameRoundNumberSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
        if (!ok) {
          socket.emit('error', { message: 'Only event administrators can start rounds', code: 'FORBIDDEN' });
          return;
        }

        const round = await gamesService.startRound(data.sessionId);

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_started', {
          sessionId: data.sessionId,
          roundId: round.id,
          roundNumber: round.round_number,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'ROUND_ERROR' });
      }
    });

    // ─── Player action (persisted to DB, broadcast) ───
    socket.on('game:action', async (data: { sessionId: string; roundId?: string; actionType: string; payload: any }) => {
      console.log('[GameAction] Received action from client', {
        actionType: data.actionType,
        sessionId: data.sessionId,
        socketId: socket.id,
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });

      const validation = gameActionSchema.safeParse(data);
      if (!validation.success) {
        console.warn('[GameAction] Validation failed:', validation.error.issues[0].message);
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        // BUG FIX: Resolve participant ID from authenticated user instead of trusting client
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          console.warn('[GameAction] Participant verification failed', { sessionId: data.sessionId, userId: user.userId });
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          return;
        }

        const activeRound = await gamesService.getActiveRound(data.sessionId);
        const roundId = data.roundId || activeRound?.id;
        if (!roundId) {
          console.warn('[GameAction] No active round found', { sessionId: data.sessionId });
          socket.emit('error', { message: 'No active round for this session', code: 'ROUND_NOT_ACTIVE' });
          return;
        }

        // Persist action to DB using server-resolved participant ID
        const action = await gamesService.submitAction(
          data.sessionId, roundId, participant.participantId, data.actionType, data.payload || {}
        );

        // Broadcast to all players in session
        gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
          userId: user.userId,
          participantId: participant.participantId,
          actionType: data.actionType,
          payload: data.payload,
          timestamp: action.created_at,
        });

        // Shared game snapshots for supported games — parallelise DB reads
        const [gameKey, latest, session] = await Promise.all([
          getSessionGameKey(data.sessionId),
          gamesService.getLatestSnapshot(data.sessionId),
          gamesService.getSession(data.sessionId),
        ]);

        if (gameKey === 'two-truths' && isTwoTruthsAction(data.actionType)) {
          // Guard: only admins/moderators can control core game flow
          const CONTROL_ACTIONS = new Set(['two_truths:start', 'two_truths:reveal', 'two_truths:next_round']);
          if (CONTROL_ACTIONS.has(data.actionType)) {
            const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
            if (!ok) {
              socket.emit('error', { message: 'Only event administrators can control the game flow', code: 'FORBIDDEN' });
              return;
            }
          }

          const next = await reduceTwoTruthsState({
            eventId: session.event_id,
            sessionId: data.sessionId,
            participantId: participant.participantId,
            actionType: data.actionType,
            payload: data.payload,
            prev: (latest?.state as any) || null,
            session,
          });

          // SECURITY: If we are in the vote phase, strip the correctLieId from the broadcast
          // so participants cannot inspect the WebSocket traffic to cheat.
          const publiclySafeState = { ...next };
          if (next.phase === 'vote' && publiclySafeState.correctLieId) {
            delete publiclySafeState.correctLieId;
          }

          const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', {
            sessionId: data.sessionId,
            gameData: publiclySafeState,
            snapshotRevisionId: savedSnapshot?.id || null,
            snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
          });
        }

        if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
          console.log('[CoffeeRoulette] Processing coffee action', {
            actionType: data.actionType,
            sessionId: data.sessionId,
            participantId: participant.participantId,
            timestamp: new Date().toISOString(),
          });

          const normalizedAction =
            data.actionType === 'coffee:end_and_finish' ? 'coffee:end' : data.actionType;

          const prevQueue = coffeeActionQueue.get(data.sessionId) ?? Promise.resolve();
          const run = prevQueue.then(async () => {
            console.log('[CoffeeRoulette] Starting action queue execution', {
              actionType: data.actionType,
              sessionId: data.sessionId,
              queueLength: coffeeActionQueue.size,
            });

            // FIX #1: Use database-level locking with transaction to prevent concurrent mutations
            const { savedSnapshot, next } = await transaction(async (client) => {
              // Acquire exclusive lock on this session's snapshot
              const lockResult = await queryOne(
                `SELECT id FROM game_state_snapshots 
                 WHERE game_session_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT 1 
                 FOR UPDATE NOWAIT`,
                [data.sessionId]
              );

              // If no snapshot exists, we still proceed (first action)
              if (!lockResult && !['coffee:shuffle'].includes(normalizedAction)) {
                // For non-shuffle actions on missing snapshot, fetch latest
                const latest = await gamesService.getLatestSnapshot(data.sessionId);
                if (latest) {
                  await query(
                    `SELECT id FROM game_state_snapshots 
                     WHERE id = $1 FOR UPDATE`,
                    [latest.id]
                  );
                }
              }

              // Re-read latest snapshot inside the lock to avoid stale prev
              const latestSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
              
              console.log('[CoffeeRoulette] Retrieved latest snapshot for', data.actionType, {
                sessionId: data.sessionId,
                currentPhase: (latestSnapshot?.state as any)?.phase,
                hasSnapshot: !!latestSnapshot,
              });

              const next = await reduceCoffeeState({
                eventId: session.event_id,
                actionType: normalizedAction,
                payload: data.payload,
                prev: (latestSnapshot?.state as any) || null,
                session,
              });

              // Atomic save: within same transaction, both save and update sequence number
              const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
              
              // FIX #1: Increment sequence number atomically within transaction
              if (savedSnapshot?.id) {
                await query(
                  `UPDATE game_state_snapshots 
                   SET action_sequence_number = action_sequence_number + 1,
                       revision_number = COALESCE(revision_number, 0) + 1,
                       revision_timestamp = NOW()
                   WHERE id = $1`,
                  [savedSnapshot.id]
                );
              }

              return { savedSnapshot, next };
            }).catch((err: any) => {
              // Handle lock timeout
              if (err.code === 'NOWAIT') {
                console.warn('[CoffeeRoulette] Another action is processing, queuing...', { sessionId: data.sessionId });
                throw new Error('Game state is being updated, please try again');
              }
              throw err;
            });

            const roomId = `game:${data.sessionId}`;
            const room = (gamesNs.adapter as any).rooms?.get?.(roomId);
            const roomSize = room && typeof room.size === 'number' ? room.size : 0;
            
            console.log('[CoffeeRoulette] Broadcasting game:data', {
              sessionId: data.sessionId,
              actionType: data.actionType,
              roomId,
              roomSize,
              gamePhase: (next as any)?.phase,
              pairCount: (next as any)?.pairs?.length,
              pairs: (next as any)?.pairs?.map((p: any) => ({
                id: p.id,
                person1: p.person1.participantId,
                person2: p.person2.participantId,
                topic: p.topic,
              })),
            });

            // FIX #2: Include sequence number and revision in broadcast
            gamesNs.to(roomId).emit('game:data', {
              sessionId: data.sessionId,
              gameData: next,
              snapshotRevisionId: savedSnapshot?.id || null,
              snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
              sequenceNumber: savedSnapshot?.action_sequence_number || 0,
              revisionNumber: savedSnapshot?.revision_number || 1,
            });

            console.log('[CoffeeRoulette] game:data broadcast sent to', roomSize, 'clients in room', roomId);

            // If requested, also close the DB session and broadcast game:ended.
            if (data.actionType === 'coffee:end_and_finish') {
              // FIX #9: Idempotent game ending
              const existingEnd = await queryOne(
                `SELECT id FROM game_sessions WHERE id = $1 AND status = 'finished'`,
                [data.sessionId]
              );

              if (!existingEnd) {
                const { results } = await gamesService.finishSession(data.sessionId);
                gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
                  sessionId: data.sessionId,
                  results,
                  timestamp: new Date().toISOString(),
                });
              } else {
                console.info('[CoffeeRoulette] Game already finished, skipping duplicate end', { sessionId: data.sessionId });
              }
            }
          });

          coffeeActionQueue.set(data.sessionId, run.then(() => undefined).catch(() => undefined));
          await run;
        }

        if (gameKey === 'strategic-escape') {
          if (!isStrategicAction(data.actionType)) {
            console.warn(`[Games] Ignoring unknown strategic action: ${data.actionType}`);
            socket.emit('error', { message: 'Unknown strategic action', code: 'VALIDATION' });
            return;
          }
          const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
          if (!ok) {
            socket.emit('error', { message: 'Only event administrators can perform strategic actions', code: 'FORBIDDEN' });
            return;
          }

          const next = await reduceStrategicState({
            eventId: session.event_id,
            actionType: data.actionType,
            payload: data.payload,
            prev: (latest?.state as any) || null,
            session,
          });
          const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', {
            sessionId: data.sessionId,
            gameData: next,
            snapshotRevisionId: savedSnapshot?.id || null,
            snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
          });
        }
      } catch (err: any) {
        console.error(`[Games] game:action error:`, err.message);
        socket.emit('error', { message: err.message, code: 'ACTION_ERROR' });
      }
    });

    // ─── End round (persisted to DB) ───
    socket.on('game:round_end', async (data: { sessionId: string; roundId: string }) => {
      const validation = gameRoundEndSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
        if (!ok) {
          socket.emit('error', { message: 'Only event administrators can end rounds', code: 'FORBIDDEN' });
          return;
        }

        // Use transaction to ensure round wasn't already ended concurrently
        await transaction(async (client) => {
          const { rows: [round] } = await client.query(
            `UPDATE game_rounds SET status = 'finished', ended_at = NOW()
             WHERE id = $1 AND game_session_id = $2 AND status = 'active' RETURNING id`,
            [data.roundId, data.sessionId]
          );
          if (!round) throw new Error('Round not found or already finished');
          return round;
        });

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_ended', {
          sessionId: data.sessionId,
          roundId: data.roundId,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'ROUND_END_ERROR' });
      }
    });

    // ─── End game (only admins, persisted — calculates results) ───
    socket.on('game:end', async (data: { sessionId: string }) => {
      const validation = gameEndSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        // FIX #9: Check if game is already finished (idempotent)
        const session = await queryOne(
          `SELECT status, end_idempotency_key FROM game_sessions WHERE id = $1`,
          [data.sessionId]
        );
        
        if (session?.status === 'finished') {
          console.info('[Games] Game already finished, returning cached results', { sessionId: data.sessionId });
          // Fetch and return cached results
          const results = await query(
            `SELECT participant_id, final_score FROM game_results WHERE game_session_id = $1`,
            [data.sessionId]
          );
          gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
            sessionId: data.sessionId,
            results: results.map((r: any) => ({ participantId: r.participant_id, score: r.final_score })),
            isRetry: true,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Coffee Roulette is designed so any participant can end the session.
        // Other games remain admin-only.
        const gameKey = await getSessionGameKey(data.sessionId);
        if (gameKey !== 'coffee-roulette') {
          const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
          if (!ok) {
            socket.emit('error', { message: 'Only event administrators can end games', code: 'FORBIDDEN' });
            return;
          }
        } else {
          // Still verify they belong to the session's event
          const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
          if (!participant) {
            socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
            return;
          }
        }

        // Fetch the latest snapshot to see if we have custom scores (e.g., Two Truths)
        const latestSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
        const state = latestSnapshot?.state as any;
        let finalScores: Record<string, number> | undefined;

        if (state?.kind === 'two-truths' && state.scores) {
          finalScores = state.scores;
        }

        // FIX #9: Use transaction to prevent double-finish
        const { results } = await transaction(async (client) => {
          // Check again inside transaction (double-check pattern)
          const sessionCheck = await queryOne(
            `SELECT status FROM game_sessions WHERE id = $1 FOR UPDATE`,
            [data.sessionId]
          );
          
          if (sessionCheck?.status === 'finished') {
            return { results: [] };
          }

          // Mark as ending to prevent concurrent finishes
          await query(
            `UPDATE game_sessions 
             SET status = 'finishing', 
                 end_action_timestamp = NOW()
             WHERE id = $1 AND status IN ('active', 'paused')`,
            [data.sessionId]
          );

          return await gamesService.finishSession(data.sessionId, finalScores);
        });

        gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
          sessionId: data.sessionId,
          results,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error(`[Games] game:end error:`, err.message);
        socket.emit('error', { message: err.message, code: 'END_ERROR' });
      }
    });

    // ─── Request current game state (snapshot) ───
    socket.on('game:state_sync', async (data: { sessionId: string }) => {
      const validation = gameStateSyncSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        // Verify user is a participant before sharing state
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'Not a participant', code: 'FORBIDDEN' });
          return;
        }

        const [session, activeRound, snapshot] = await Promise.all([
          gamesService.getSession(data.sessionId),
          gamesService.getActiveRound(data.sessionId),
          gamesService.getLatestSnapshot(data.sessionId),
        ]);
        socket.emit('game:state', {
          sessionId: data.sessionId,
          state: {
            status: session.status,
            currentRound: session.current_round,
            startedAt: session.started_at,
            endedAt: session.ended_at,
            sessionDeadlineAt: (session as any).session_deadline_at || null,
            resolvedTiming: (session as any).resolved_timing || null,
            activeRoundId: activeRound?.id || null,
            snapshot: snapshot?.state || null,
            snapshotRevisionId: snapshot?.id || null,
            snapshotCreatedAt: toSnapshotCreatedAt(snapshot?.created_at),
          },
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'STATE_ERROR' });
      }
    });

    // ─── Coffee Roulette Voice Signaling (WebRTC) ───
    // Offer/Answer are role-gated to avoid glare:
    // - pair.person1 creates the offer
    // - pair.person2 answers
    // ICE + hangup can be sent by either participant (validated against pair membership).
    socket.on('coffee:voice_offer', async (data: unknown, ack) => {
      const validation = coffeeVoiceOfferSchema.safeParse(data);
      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!caller) {
          console.warn('[CoffeeVoice] voice_offer: caller not a participant', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            userId: user.userId,
          });
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
          console.warn('[CoffeeVoice] voice_offer rejected: not in chatting phase', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            kind: state?.kind,
            phase: state?.phase,
          });
          ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' });
          return;
        }

        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const callerSide: 'person1' | 'person2' | null =
          pair.person1?.participantId === caller.participantId ? 'person1'
          : pair.person2?.participantId === caller.participantId ? 'person2'
          : null;

        if (!callerSide) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }
        if (callerSide !== 'person1') {
          ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
          return;
        }

        const partnerParticipantId = pair.person2?.participantId;
        if (!partnerParticipantId) {
          console.warn('[CoffeeVoice] voice_offer rejected: partner missing', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            callerParticipantId: caller.participantId,
          });
          ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
          return;
        }

        // FIX #2: Cache offer immediately so the answerer can request it even if they enable voice
        // slightly after the initial offer was emitted.
        const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
        coffeeVoiceOfferCache.set(cacheKey, {
          sdp: validation.data.sdp,
          fromParticipantId: caller.participantId,
          createdAt: Date.now(),
        });

        console.log('[CoffeeVoice] Offer cached for partner retrieval', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
        });

        const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
        const partnerSocketId = voiceSocketByKey.get(partnerKey);

        if (partnerSocketId) {
          // Partner is already listening for voice - send offer immediately
          console.log('[CoffeeVoice] Sending offer directly to connected partner', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            partnerSocketId,
          });

          gamesNs.to(partnerSocketId).emit('coffee:voice_offer', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            fromParticipantId: caller.participantId,
            sdp: validation.data.sdp,
          });

          ack?.({ ok: true });
        } else {
          // FIX #2: Partner not yet listening for voice - send notification
          // so they know to request the cached offer
          console.log('[CoffeeVoice] Partner socket not found, sending awaiting notification', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            partnerParticipantId,
          });

          const roomId = `game:${validation.data.sessionId}`;
          gamesNs.to(roomId).emit('coffee:voice_offer_awaiting', {
            pairId: validation.data.pairId,
            fromParticipantId: caller.participantId,
            toParticipantId: partnerParticipantId,
          });

          ack?.({ ok: true, waiting: true });
        }
      } catch (err) {
        console.error('[voice_offer] error:', err);
        ack?.({ ok: false, error: 'VOICE_OFFER_ERROR' });
      }
    });

    // Answerer can request the most recent offer if they enabled voice after the offer was sent.
    socket.on('coffee:voice_request_offer', async (data: unknown, ack) => {
      const validation = coffeeVoiceRequestOfferSchema.safeParse(data);
      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!caller) {
          console.warn('[CoffeeVoice] voice_request_offer: caller not a participant', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            userId: user.userId,
          });
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
          ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' });
          return;
        }

        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const callerSide: 'person1' | 'person2' | null =
          pair.person1?.participantId === caller.participantId ? 'person1'
          : pair.person2?.participantId === caller.participantId ? 'person2'
          : null;

        // Only person2 (answerer) requests the offer to avoid glare.
        if (!callerSide) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }
        if (callerSide !== 'person2') {
          ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
          return;
        }

        const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
        const cached = coffeeVoiceOfferCache.get(cacheKey);
        if (!cached) {
          ack?.({ ok: false, error: 'OFFER_NOT_READY' });
          return;
        }

        const ageMs = Date.now() - cached.createdAt;
        if (ageMs > COFFEE_VOICE_OFFER_TTL_MS) {
          coffeeVoiceOfferCache.delete(cacheKey);
          ack?.({ ok: false, error: 'OFFER_EXPIRED' });
          return;
        }

        socket.emit('coffee:voice_offer', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: cached.fromParticipantId,
          sdp: cached.sdp,
        });

        ack?.({ ok: true });
      } catch (err) {
        console.error('[CoffeeVoice] voice_request_offer error:', err);
        ack?.({ ok: false, error: 'VOICE_REQUEST_OFFER_ERROR' });
      }
    });

    socket.on('coffee:voice_answer', async (data: unknown, ack) => {
      const validation = coffeeVoiceAnswerSchema.safeParse(data);
      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!caller) {
          console.warn('[CoffeeVoice] voice_answer: caller not a participant', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            userId: user.userId,
          });
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
          ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' });
          return;
        }

        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const callerSide: 'person1' | 'person2' | null =
          pair.person1?.participantId === caller.participantId ? 'person1'
          : pair.person2?.participantId === caller.participantId ? 'person2'
          : null;

        if (!callerSide) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }
        if (callerSide !== 'person2') {
          console.warn('[CoffeeVoice] voice_answer rejected: role mismatch', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            callerParticipantId: caller.participantId,
            callerSide,
          });
          ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
          return;
        }

        const partnerParticipantId = pair.person1?.participantId;
        if (!partnerParticipantId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
          return;
        }

        const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
        const partnerSocketId = voiceSocketByKey.get(partnerKey);
        if (!partnerSocketId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_CONNECTED' });
          return;
        }

        gamesNs.to(partnerSocketId).emit('coffee:voice_answer', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          sdp: validation.data.sdp,
        });

        ack?.({ ok: true });
      } catch (err) {
        console.error('[voice_answer] error:', err);
        ack?.({ ok: false, error: 'VOICE_ANSWER_ERROR' });
      }
    });

    socket.on('coffee:voice_ice_candidate', async (data: unknown, ack) => {
      const validation = coffeeVoiceIceCandidateSchema.safeParse(data);
      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!caller) {
          console.warn('[CoffeeVoice] voice_ice_candidate: caller not a participant', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            userId: user.userId,
          });
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
          ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' });
          return;
        }

        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const isInPair =
          pair.person1?.participantId === caller.participantId || pair.person2?.participantId === caller.participantId;
        if (!isInPair) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }

        const partnerParticipantId =
          pair.person1?.participantId === caller.participantId ? pair.person2?.participantId : pair.person1?.participantId;

        if (!partnerParticipantId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
          return;
        }

        const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
        const partnerSocketId = voiceSocketByKey.get(partnerKey);
        if (!partnerSocketId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_CONNECTED' });
          return;
        }

        gamesNs.to(partnerSocketId).emit('coffee:voice_ice_candidate', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          candidate: validation.data.candidate,
        });

        ack?.({ ok: true });
      } catch (err) {
        console.error('[voice_ice_candidate] error:', err);
        ack?.({ ok: false, error: 'VOICE_ICE_ERROR' });
      }
    });

    socket.on('coffee:voice_hangup', async (data: unknown, ack) => {
      const validation = coffeeVoiceHangupSchema.safeParse(data);
      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!caller) {
          console.warn('[CoffeeVoice] voice_hangup: caller not a participant', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            userId: user.userId,
          });
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        if (state?.kind !== 'coffee-roulette') {
          ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' });
          return;
        }

        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const isInPair =
          pair.person1?.participantId === caller.participantId || pair.person2?.participantId === caller.participantId;
        if (!isInPair) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }

        const partnerParticipantId =
          pair.person1?.participantId === caller.participantId ? pair.person2?.participantId : pair.person1?.participantId;
        if (!partnerParticipantId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
          return;
        }

        const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
        const partnerSocketId = voiceSocketByKey.get(partnerKey);
        if (partnerSocketId) {
          gamesNs.to(partnerSocketId).emit('coffee:voice_hangup', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            fromParticipantId: caller.participantId,
          });
        }

        // Clear cached offer since the call is no longer active.
        const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
        coffeeVoiceOfferCache.delete(cacheKey);

        ack?.({ ok: true });
      } catch (err) {
        console.error('[voice_hangup] error:', err);
        ack?.({ ok: false, error: 'VOICE_HANGUP_ERROR' });
      }
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', async (reason) => {

      // Cleanup targeted voice signaling mappings.
      const keys = voiceKeysBySocket.get(socket.id);
      if (keys) {
        for (const key of keys) voiceSocketByKey.delete(key);
        voiceKeysBySocket.delete(socket.id);
      }

      for (const sessionId of joinedSessions) {
        const participantId = joinedParticipantBySessionId.get(sessionId);

        // IMPORTANT: disconnect/reload must NOT mark event participation as left.
        // Guests and members should keep their participant identity across temporary socket drops.

        socket.to(`game:${sessionId}`).emit('game:player_left', {
          userId: user.userId,
          sessionId,
          timestamp: new Date().toISOString(),
        });

        // Coffee Roulette: if we were currently matching/chatting with this participant,
        // re-run pairing so everyone sees the "next match" automatically.
        if (participantId) {
          const prevQueue = coffeeActionQueue.get(sessionId) ?? Promise.resolve();
          const run = prevQueue.then(async () => {
            try {
              const [latestSnapshot, session] = await Promise.all([
                gamesService.getLatestSnapshot(sessionId),
                gamesService.getSession(sessionId),
              ]);
              const state = latestSnapshot?.state as any;
              if (state?.kind !== 'coffee-roulette') return;
              if (!['matching', 'chatting'].includes(state?.phase)) return;

              const inPairs = (state?.pairs || []).some((p: any) => {
                return (
                  p?.person1?.participantId === participantId ||
                  p?.person2?.participantId === participantId
                );
              });
              if (!inPairs) return;

              const next = await reduceCoffeeState({
                eventId: session.event_id,
                actionType: 'coffee:shuffle',
                payload: {},
                prev: (latestSnapshot?.state as any) || null,
              });

              const savedSnapshot = await gamesService.saveSnapshot(sessionId, next);
              gamesNs.to(`game:${sessionId}`).emit('game:data', {
                sessionId,
                gameData: next,
                snapshotRevisionId: savedSnapshot?.id || null,
                snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
              });
            } catch (err) {
              console.error('[Games] coffee rematch on disconnect failed', {
                sessionId,
                participantId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });

          coffeeActionQueue.set(sessionId, run.then(() => undefined).catch(() => undefined));
          void run;
        }
      }
      joinedSessions.clear();
      joinedParticipantBySessionId.clear();
    });
  });
}
