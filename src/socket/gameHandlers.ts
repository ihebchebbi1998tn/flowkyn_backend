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

// ============================================
// AUDIT LOGGING HELPER - Issue #4
// ============================================

/**
 * Log action to audit_logs table for investigation and dispute resolution
 * Non-blocking: logs asynchronously, errors are caught and logged
 */
async function logAuditEvent(data: {
  eventId: string;
  gameSessionId?: string;
  participantId?: string;
  userId?: string;
  action: string; // e.g., 'vote_cast', 'vote_failed', 'role_assigned'
  details?: any;
  ipAddress?: string;
  status?: 'success' | 'error' | 'retry';
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (event_id, game_session_id, participant_id, user_id, action, details, ip_address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.eventId,
        data.gameSessionId || null,
        data.participantId || null,
        data.userId || null,
        data.action,
        data.details ? JSON.stringify(data.details) : null,
        data.ipAddress || null,
        data.status || 'success',
      ]
    );
  } catch (err: any) {
    // Non-blocking: log error but don't throw
    console.error('[Audit] Failed to log event:', {
      action: data.action,
      error: err?.message,
      timestamp: new Date().toISOString(),
    });
  }
}

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

// ─── FIX #4: SDP Validation for WebRTC ───
/**
 * Validates SDP (Session Description Protocol) format.
 * SDP is used in WebRTC offer/answer for session negotiation.
 * 
 * CRITICAL: Invalid SDP can cause:
 * - Peer connection creation failures
 * - Silent call failures
 * - Browser console errors
 * 
 * Valid SDP must:
 * - Start with "v=0" (version)
 * - Contain "o=" (origin line)
 * - Contain "m=" (media section)
 */
function validateSDP(sdp: string): boolean {
  // Basic format checks
  if (!sdp || typeof sdp !== 'string') return false;
  if (sdp.length < 50) return false;  // Too short to be valid SDP
  if (sdp.length > 200000) return false;  // Too long
  
  // Check for required SDP sections
  if (!sdp.includes('v=0')) return false;  // Version line required
  if (!sdp.includes('o=')) return false;   // Origin line required
  if (!sdp.includes('m=')) return false;   // Media section required
  
  // Reject obvious injection attempts
  if (sdp.includes('<') || sdp.includes('>')) return false;  // HTML tags
  if (sdp.includes('javascript:')) return false;
  if (sdp.includes('script')) return false;
  
  return true;
}

// ─── Coffee Roulette Voice (WebRTC signaling) ───
const coffeeVoiceOfferSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  // Pair id generated during `coffee:shuffle` and stored in the coffee snapshot.
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(50, 'SDP too short - invalid format')
    .max(200000, 'SDP too large')
    .refine(validateSDP, { message: 'Invalid SDP format' }),
});

const coffeeVoiceAnswerSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(50, 'SDP too short - invalid format')
    .max(200000, 'SDP too large')
    .refine(validateSDP, { message: 'Invalid SDP format' }),
});

const coffeeVoiceIceCandidateSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  candidate: z
    .object({
      candidate: z
        .string()
        .max(20000)
        .refine(
          (val) => {
            // ICE candidate must either be empty (end of candidates) or valid format
            // Valid candidates start with "candidate:"
            return val === '' || val.startsWith('candidate:');
          },
          { message: 'Invalid ICE candidate format' }
        ),
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

// ============================================
// PAYLOAD VALIDATION SCHEMAS - FIX #3
// ============================================

// Two Truths payload validation
const twoTruthsSubmitSchema = z.object({
  statements: z
    .array(
      z
        .string()
        .trim()
        .min(3, 'Each statement must be at least 3 characters')
        .max(300, 'Each statement must be at most 300 characters')
    )
    .length(3, 'You must provide exactly 3 statements'),
  lieIndex: z
    .number()
    .int()
    .min(0)
    .max(2)
    .optional()
    .default(2),
});

const twoTruthsVoteSchema = z.object({
  statementId: z.enum(['s0', 's1', 's2'], {
    errorMap: () => ({ message: 'Invalid statement ID. Must be s0, s1, or s2' }),
  }),
});

const twoTruthsRevealSchema = z.object({
  lieId: z
    .enum(['s0', 's1', 's2'], {
      errorMap: () => ({ message: 'Invalid lie ID. Must be s0, s1, or s2' }),
    })
    .optional(),
});

// Coffee Roulette payload validation
const coffeeNextPromptSchema = z.object({
  expectedPromptsUsed: z
    .number()
    .int()
    .min(0, 'Expected prompts used cannot be negative'),
});

const coffeeContinueSchema = z.object({
  expectedPromptsUsed: z
    .number()
    .int()
    .min(0, 'Expected prompts used cannot be negative'),
});

// Strategic Escape payload validation
const strategicConfigureSchema = z.object({
  industryKey: z
    .string()
    .max(100, 'Industry key too long')
    .optional(),
  crisisKey: z
    .string()
    .max(100, 'Crisis key too long')
    .optional(),
  difficultyKey: z
    .enum(['easy', 'medium', 'hard'], {
      errorMap: () => ({ message: 'Difficulty must be easy, medium, or hard' }),
    })
    .optional(),
  industryLabel: z
    .string()
    .max(200, 'Industry label too long')
    .optional(),
  crisisLabel: z
    .string()
    .max(200, 'Crisis label too long')
    .optional(),
  difficultyLabel: z
    .string()
    .max(100, 'Difficulty label too long')
    .optional(),
});

const strategicAssignRolesSchema = z.object({
  roles: z
    .record(
      z.string().uuid('Invalid participant ID'),
      z
        .string()
        .max(50, 'Role key too long')
    )
    .refine(
      (roles) => Object.keys(roles).length > 0,
      { message: 'At least one role must be assigned' }
    ),
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

// Session game keys never change — cache indefinitely per process.
const sessionGameKeyCache = new Map<string, string>();

async function getSessionGameKey(sessionId: string): Promise<string | null> {
  const cached = sessionGameKeyCache.get(sessionId);
  if (cached) return cached;
  const row = await queryOne<{ key: string }>(
    `SELECT gt.key
     FROM game_sessions gs
     JOIN game_types gt ON gt.id = gs.game_type_id
     WHERE gs.id = $1`,
    [sessionId]
  );
  const key = row?.key || null;
  if (key) sessionGameKeyCache.set(sessionId, key);
  return key;
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
  const { eventId, participantId, actionType, payload, prev, session } = args;

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
    // Only allow starting from idle phases — prevent mid-game resets.
    if (base.phase !== 'waiting' && base.phase !== 'results') return base;
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
    
    // FIX #1: Atomic vote recording - use database INSERT with unique constraint
    // to prevent race conditions. Never fall back to in-memory state.
    try {
      // This will use the unique constraint to prevent duplicate votes
      // and atomic INSERT ensures only one vote per participant
      const voteResult = await query(
        `INSERT INTO game_votes (game_session_id, participant_id, statement_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (game_session_id, participant_id) 
         DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()
         RETURNING statement_id`,
        [session?.id, participantId, choice]
      );
      
      if (!voteResult?.[0]) {
        throw new Error('Vote insertion returned no result - database write failed');
      }
      
      console.log('[TwoTruths] Atomic vote recorded successfully', { 
        sessionId: session?.id, 
        participantId, 
        choice,
        dbConfirmed: true 
      });
    } catch (err: any) {
      console.error('[TwoTruths] CRITICAL: Failed to record vote atomically', { 
        sessionId: session?.id,
        participantId, 
        choice,
        error: err?.message,
        stack: err?.stack 
      });
      
      // FIX #1: Don't fall back to in-memory state - reject the action entirely
      // This prevents vote loss due to race conditions
      throw new Error('Failed to record your vote. Please try voting again.');
    }
    
    // Update in-memory state with database-confirmed vote
    return { ...base, votes: { ...base.votes, [participantId]: choice } };
  }

  if (actionType === 'two_truths:reveal') {
    // Guard: reveal is only valid after voting has happened.
    if (base.phase !== 'vote') return base;
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
    // Guard: can only advance rounds from the reveal phase.
    if (base.phase !== 'reveal') return base;
    const nextRound = (base.round ?? 1) + 1;
    // FIX #3: Defensive null check on totalRounds
    const totalRounds = base.totalRounds ?? 4; // Fallback to 4 if undefined
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
    // FIX #3: Defensive null check on pairs array
    if (!Array.isArray(base.pairs) || base.pairs.length === 0) {
      console.warn('[CoffeeRoulette] Ignoring coffee:start_chat without pairs', {
        eventId,
        phase: base.phase,
      });
      return { ...base, phase: 'waiting', startedChatAt: null };
    }
    // FIX #3: Defensive null checks on session timing values
    const chatDurationMinutes = Math.max(
      1,
      Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes ?? 30)
    );
    return { 
      ...base, 
      phase: 'chatting',
      gameStatus: 'in_progress', // FIX #2: Game is in progress 
      startedChatAt: new Date().toISOString(),
      chatDurationMinutes,
      chatEndsAt: new Date(Date.now() + chatDurationMinutes * 60000).toISOString(),
      // Start with 1 prompt already assigned on shuffle
      promptsUsed: Math.max(1, base.promptsUsed ?? 0),
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
    // FIX #3: Defensive null checks on Strategic Escape timing
    discussionDurationMinutes: Math.max(
      1,
      Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes ?? 45)
    ),
    gameStatus: 'waiting',
  };

  if (actionType === 'strategic:configure') {
    // Guard: configuration is only valid during the setup phase.
    // Allowing it later would reset the game phase/status mid-play.
    if (base.phase !== 'setup') return base;
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
    // Guard: roles can only be assigned from the setup phase.
    if (base.phase !== 'setup') return base;
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
    // Guard: discussion can only start once roles are assigned.
    if (base.phase !== 'roles_assignment') {
      // Idempotent: if discussion already running, no-op.
      if (base.phase === 'discussion' && base.discussionEndsAt) return base;
      // Any other phase transition is invalid.
      if (base.phase !== 'discussion') return base;
    }
    // FIX #3: Defensive null checks on discussion timing
    const minutes = typeof payload?.durationMinutes === 'number'
      ? payload.durationMinutes
      : Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes ?? 45);
    return {
      ...base,
      phase: 'discussion',
      discussionDurationMinutes: Math.max(1, Number(minutes ?? base.discussionDurationMinutes ?? 45)),
      discussionEndsAt: new Date(Date.now() + (minutes ?? base.discussionDurationMinutes ?? 45) * 60000).toISOString(),
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

/**
 * FIX #2: Enrich Coffee Roulette snapshot for late joiners.
 * Ensures the joining participant knows:
 * - If they're already paired (and with whom)
 * - What the conversation topic is
 * - What phase they're joining in
 * - If they're unpaired and why
 */
async function enrichCoffeeSnapshotForLateJoiner(
  snapshot: any,
  sessionId: string,
  participantId: string,
  _eventId: string
): Promise<any> {
  if (!snapshot || snapshot.kind !== 'coffee-roulette') {
    return snapshot;
  }

  // Find this participant in the current pair list
  const pair = (snapshot.pairs || []).find(
    (p: any) => p.person1.participantId === participantId || p.person2.participantId === participantId
  );

  // If they should be paired but aren't, check if they're marked as unpaired
  let unpairedStatus: string | null = null;
  if (!pair && (snapshot.phase === 'chatting' || snapshot.phase === 'matching')) {
    try {
      const unpaired = await queryOne<{ reason: string; resolved_at: string | null }>(
        `SELECT reason, resolved_at FROM coffee_roulette_unpaired
         WHERE game_session_id = $1 AND participant_id = $2`,
        [sessionId, participantId]
      );
      
      if (unpaired && !unpaired.resolved_at) {
        unpairedStatus = unpaired.reason; // 'odd_count', 'disconnect', etc.
      }
    } catch (err) {
      console.warn('[CoffeeRoulette] Failed to check unpaired status for late joiner', {
        sessionId,
        participantId,
        error: err
      });
    }
  }

  return {
    ...snapshot,
    // Add metadata for this specific participant
    _currentUserParticipantId: participantId,
    _currentUserPair: pair || null,
    _currentUserUnpairedReason: unpairedStatus,
    _currentUserPhase: snapshot.phase,
    _snapshotIsEnrichedForLateJoiner: true,
  };
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
  // Pending modal-based call requests for reconnect delivery.
  // key: `${sessionId}:${pairId}:${toParticipantId}` -> modal payload + createdAt
  const pendingVoiceCallRequests = new Map<
    string,
    {
      modal: {
        type: 'receiver';
        sessionId: string;
        pairId: string;
        initiatorParticipantId: string;
        initiatorName?: string;
        initiatorAvatar?: string;
        message: string;
        toParticipantId: string;
      };
      createdAt: number;
    }
  >();
  const COFFEE_VOICE_CALL_REQUEST_TTL_MS = 45 * 1000;

  // Serialize Coffee Roulette snapshot transitions per session.
  // Prevents concurrent next_prompt/continue requests from racing on stale snapshots.
  const coffeeActionQueue = new Map<string, Promise<void>>();

  // Serialize Two Truths snapshot transitions per session.
  // Prevents concurrent vote/submit/reveal requests from racing on stale snapshots.
  const twoTruthsActionQueue = new Map<string, Promise<void>>();

  // Serialize Strategic Escape snapshot transitions per session.
  // Prevents concurrent configure/assign_roles/start_discussion from racing.
  const strategicActionQueue = new Map<string, Promise<void>>();

  // Proactively evict expired WebRTC offer cache entries every 10 minutes.
  // On-read TTL checks only cover retrieved entries; this prevents unbounded growth.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of coffeeVoiceOfferCache) {
      if (now - entry.createdAt > COFFEE_VOICE_OFFER_TTL_MS) {
        coffeeVoiceOfferCache.delete(key);
      }
    }
    for (const [key, entry] of pendingVoiceCallRequests) {
      if (now - entry.createdAt > COFFEE_VOICE_CALL_REQUEST_TTL_MS) {
        pendingVoiceCallRequests.delete(key);
      }
    }
  }, 10 * 60 * 1000);

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

        // Re-deliver pending call requests targeted to this participant.
        // This covers reconnect timing where the original emit was missed.
        for (const [pendingKey, pending] of pendingVoiceCallRequests) {
          if (
            pending.modal.sessionId === data.sessionId &&
            pending.modal.toParticipantId === participant.participantId &&
            Date.now() - pending.createdAt <= COFFEE_VOICE_CALL_REQUEST_TTL_MS
          ) {
            gamesNs.to(`game:${data.sessionId}`).emit('coffee:voice_call_modal', pending.modal);
            console.log('[CoffeeVoice] Re-delivered pending voice call modal on join', {
              sessionId: data.sessionId,
              pairId: pending.modal.pairId,
              toParticipantId: participant.participantId,
              pendingKey,
            });
          }
        }

        // Notify others
        socket.to(roomId).emit('game:player_joined', {
          userId: user.userId,
          participantId: participant.participantId,
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

          // FIX #2: Comprehensive late joiner enrichment for Coffee Roulette
          let enrichedSnapshot = snapshot?.state;
          if (enrichedSnapshot && (enrichedSnapshot as any).kind === 'coffee-roulette') {
            try {
              enrichedSnapshot = await enrichCoffeeSnapshotForLateJoiner(
                enrichedSnapshot,
                data.sessionId,
                participant.participantId,
                session.event_id
              );
            } catch (err) {
              console.warn('[CoffeeRoulette] Failed to enrich snapshot for late joiner', {
                sessionId: data.sessionId,
                participantId: participant.participantId,
                error: err
              });
              // Continue without enrichment rather than failing the join
            }
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
      const participantId = joinedParticipantBySessionId.get(data.sessionId);

      socket.leave(roomId);
      joinedSessions.delete(data.sessionId);
      joinedParticipantBySessionId.delete(data.sessionId);

      // Remove voice socket keys for this session.
      const keys = voiceKeysBySocket.get(socket.id);
      if (keys) {
        for (const key of Array.from(keys)) {
          if (key.startsWith(`${data.sessionId}:`)) {
            voiceSocketByKey.delete(key);
            keys.delete(key);
            // Also evict any cached WebRTC offer this participant sent.
            // (Cache key format: `${sessionId}:${pairId}` — scan for session prefix.)
          }
        }
        if (keys.size === 0) voiceKeysBySocket.delete(socket.id);
      }

      socket.to(roomId).emit('game:player_left', {
        userId: user.userId,
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });

      // Coffee Roulette: re-run pairing when a paired participant leaves,
      // matching the same rematch behaviour as the disconnect handler.
      if (participantId) {
        const prevQueue = coffeeActionQueue.get(data.sessionId) ?? Promise.resolve();
        const run = prevQueue.then(async () => {
          try {
            const [latestSnapshot, session] = await Promise.all([
              gamesService.getLatestSnapshot(data.sessionId),
              gamesService.getSession(data.sessionId),
            ]);
            const state = latestSnapshot?.state as any;
            if (state?.kind !== 'coffee-roulette') return;
            if (!['matching', 'chatting'].includes(state?.phase)) return;

            const inPairs = (state?.pairs || []).some((p: any) =>
              p?.person1?.participantId === participantId ||
              p?.person2?.participantId === participantId
            );
            if (!inPairs) return;

            const next = await reduceCoffeeState({
              eventId: session.event_id,
              actionType: 'coffee:shuffle',
              payload: {},
              prev: (latestSnapshot?.state as any) || null,
            });

            const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
            gamesNs.to(roomId).emit('game:data', {
              sessionId: data.sessionId,
              gameData: next,
              snapshotRevisionId: savedSnapshot?.id || null,
              snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
            });
          } catch (err) {
            console.error('[Games] coffee rematch on leave failed', {
              sessionId: data.sessionId,
              participantId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
        coffeeActionQueue.set(
          data.sessionId,
          run.then(() => undefined).catch(() => undefined),
        );
        void run;
      }
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
        // Use cached participant ID from game:join to avoid a DB round-trip on every action.
        // Fall back to full verification only when not yet joined (e.g. re-connected socket).
        let participant: { participantId: string } | null = null;
        const cachedParticipantId = joinedParticipantBySessionId.get(data.sessionId);
        if (cachedParticipantId) {
          participant = { participantId: cachedParticipantId };
        } else {
          participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
          if (participant) joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
        }
        if (!participant) {
          console.warn('[GameAction] Participant verification failed', { sessionId: data.sessionId, userId: user.userId });
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          return;
        }

        const roundId = data.roundId || (await gamesService.getActiveRound(data.sessionId))?.id;
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
        const [gameKey, session] = await Promise.all([
          getSessionGameKey(data.sessionId),
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

          // FIX #3: Add payload validation for Two Truths actions
          if (data.actionType === 'two_truths:submit') {
            const payloadValidation = twoTruthsSubmitSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid submission: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION',
                issues: payloadValidation.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
              });
              return;
            }
            data.payload = payloadValidation.data; // Use validated data
          }

          if (data.actionType === 'two_truths:vote') {
            const payloadValidation = twoTruthsVoteSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid vote: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION',
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          if (data.actionType === 'two_truths:reveal') {
            const payloadValidation = twoTruthsRevealSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid reveal',
                code: 'VALIDATION'
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          // Serialize per-session to prevent concurrent actions racing on stale snapshots.
          const ttPrev = twoTruthsActionQueue.get(data.sessionId) ?? Promise.resolve();
          const ttRun = ttPrev.then(async () => {
            // Re-read latest snapshot inside the queue to avoid stale prev.
            const freshLatest = await gamesService.getLatestSnapshot(data.sessionId);

            const next = await reduceTwoTruthsState({
              eventId: session.event_id,
              sessionId: data.sessionId,
              participantId: participant.participantId,
              actionType: data.actionType,
              payload: data.payload,
              prev: (freshLatest?.state as any) || null,
              session,
            });

            // SECURITY: strip correctLieId during vote phase so clients can't cheat.
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

            return savedSnapshot;
          });

          twoTruthsActionQueue.set(
            data.sessionId,
            ttRun.then(() => undefined).catch(() => undefined),
          );

          const savedSnapshot = await ttRun;

          // FIX #4: Log vote actions to audit trail for dispute resolution
          if (data.actionType === 'two_truths:vote' && savedSnapshot) {
            const voteChoice = data.payload?.statementId;
            logAuditEvent({
              eventId: session.event_id,
              gameSessionId: data.sessionId,
              participantId: participant.participantId,
              userId: user.userId,
              action: 'vote_cast',
              details: {
                game: 'two-truths',
                statementId: voteChoice,
                round: (savedSnapshot?.state as any)?.round,
                phase: (savedSnapshot?.state as any)?.phase,
                timestamp: new Date().toISOString(),
              },
              ipAddress: socket.handshake.address,
              status: 'success',
            });
          }
        }

        if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
          console.log('[CoffeeRoulette] Processing coffee action', {
            actionType: data.actionType,
            sessionId: data.sessionId,
            participantId: participant.participantId,
            timestamp: new Date().toISOString(),
          });

          // FIX #3: Add payload validation for Coffee Roulette actions
          if (data.actionType === 'coffee:next_prompt') {
            const payloadValidation = coffeeNextPromptSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid prompt request: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION'
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          if (data.actionType === 'coffee:continue') {
            const payloadValidation = coffeeContinueSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid continue request: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION'
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          const normalizedAction =
            data.actionType === 'coffee:end_and_finish' ? 'coffee:end' : data.actionType;

          const prevQueue = coffeeActionQueue.get(data.sessionId) ?? Promise.resolve();
          const run = prevQueue.then(async () => {
            console.log('[CoffeeRoulette] Starting action queue execution', {
              actionType: data.actionType,
              sessionId: data.sessionId,
              queueLength: coffeeActionQueue.size,
            });

            // coffeeActionQueue serializes all actions per session within this process.
            // Re-read the latest snapshot inside the queue slot to avoid stale prev.
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

            const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);

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

            // When the session ends, evict all cached WebRTC offers for this session
            // so stale SDP entries don't accumulate across games.
            if (normalizedAction === 'coffee:end') {
              for (const cacheKey of Array.from(coffeeVoiceOfferCache.keys())) {
                if (cacheKey.startsWith(`${data.sessionId}:`)) {
                  coffeeVoiceOfferCache.delete(cacheKey);
                }
              }
            }

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

          coffeeActionQueue.set(
            data.sessionId,
            run
              .then(() => undefined)
              .catch((err) => {
                // ⚠️ CRITICAL: Log async coffee roulette action errors instead of swallowing them
                console.error('[CoffeeRoulette] Async action failed:', {
                  sessionId: data.sessionId,
                  actionType: data.actionType,
                  userId: user.userId,
                  error: err instanceof Error ? err.message : String(err),
                  stack: err instanceof Error ? err.stack : undefined,
                });
                // Re-throw to maintain promise chain integrity
                throw err;
              })
          );
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

          // FIX #3: Add payload validation for Strategic Escape actions
          if (data.actionType === 'strategic:configure') {
            const payloadValidation = strategicConfigureSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid configuration: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION'
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          if (data.actionType === 'strategic:assign_roles') {
            const payloadValidation = strategicAssignRolesSchema.safeParse(data.payload);
            if (!payloadValidation.success) {
              socket.emit('error', { 
                message: 'Invalid role assignment: ' + payloadValidation.error.issues[0].message,
                code: 'VALIDATION'
              });
              return;
            }
            data.payload = payloadValidation.data;
          }

          // Serialize per-session to prevent concurrent strategic actions racing on stale snapshots.
          const strPrev = strategicActionQueue.get(data.sessionId) ?? Promise.resolve();
          const strRun = strPrev.then(async () => {
            // Re-read latest snapshot inside the queue to avoid stale prev.
            const freshLatest = await gamesService.getLatestSnapshot(data.sessionId);

            const next = await reduceStrategicState({
              eventId: session.event_id,
              actionType: data.actionType,
              payload: data.payload,
              prev: (freshLatest?.state as any) || null,
              session,
            });
            const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
            gamesNs.to(`game:${data.sessionId}`).emit('game:data', {
              sessionId: data.sessionId,
              gameData: next,
              snapshotRevisionId: savedSnapshot?.id || null,
              snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
            });
          });

          strategicActionQueue.set(
            data.sessionId,
            strRun.catch(() => undefined),
          );

          await strRun;
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
          // Still verify they belong to the session's event — use cache when available.
          const cachedEndParticipantId = joinedParticipantBySessionId.get(data.sessionId);
          if (!cachedEndParticipantId) {
            const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
            if (!participant) {
              socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
              return;
            }
            joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
          }
        }

        // Fetch the latest snapshot to see if we have custom scores (e.g., Two Truths)
        const latestSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
        const state = latestSnapshot?.state as any;
        let finalScores: Record<string, number> | undefined;

        if (state?.kind === 'two-truths' && state.scores) {
          finalScores = state.scores;
        }

        // Use a row-locked transaction so only one concurrent request finishes the game.
        // The early status check above is a fast-path optimisation only; the real guard is here.
        const { results, alreadyFinished } = await transaction(async () => {
          // Acquire row lock — only one concurrent request proceeds past here.
          const sessionCheck = await queryOne(
            `SELECT status FROM game_sessions WHERE id = $1 FOR UPDATE`,
            [data.sessionId]
          );

          if (sessionCheck?.status === 'finished' || sessionCheck?.status === 'finishing') {
            return { results: [] as any[], alreadyFinished: true };
          }

          // Mark as finishing atomically so any racing request sees this and backs off.
          await query(
            `UPDATE game_sessions SET status = 'finishing', end_action_timestamp = NOW()
             WHERE id = $1 AND status IN ('active', 'paused')`,
            [data.sessionId]
          );

          const finishResult = await gamesService.finishSession(data.sessionId, finalScores);
          return { ...finishResult, alreadyFinished: false };
        });

        // Only broadcast if this request was the one that actually finished the game.
        if (!alreadyFinished) {
          gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
            sessionId: data.sessionId,
            results,
            timestamp: new Date().toISOString(),
          });
        }
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
        // Use cached participant ID from game:join — avoid a DB query on every 30s poll.
        const cachedSyncParticipantId = joinedParticipantBySessionId.get(data.sessionId);
        if (!cachedSyncParticipantId) {
          const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
          if (!participant) {
            socket.emit('error', { message: 'Not a participant', code: 'FORBIDDEN' });
            return;
          }
          joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
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

    // ─── Coffee Roulette Voice Call Request (Modal) ───
    // When a user clicks "Open Voice Call", they initiate a modal-based request
    // The initiator gets a confirmation modal, and the partner gets a request modal
    socket.on('coffee:voice_call_request', async (data: unknown, ack) => {
      const validation = z.object({
        sessionId: z.string().uuid('Invalid session ID'),
        pairId: z.string().uuid('Invalid pair ID'),
      }).safeParse(data);

      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const initiator = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!initiator) {
          console.warn('[CoffeeVoice] voice_call_request: initiator not a participant', {
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

        // Verify initiator is in this pair
        const initiatorSide: 'person1' | 'person2' | null =
          pair.person1?.participantId === initiator.participantId ? 'person1'
          : pair.person2?.participantId === initiator.participantId ? 'person2'
          : null;

        if (!initiatorSide) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }

        const partnerParticipantId =
          initiatorSide === 'person1' ? pair.person2?.participantId : pair.person1?.participantId;
        
        if (!partnerParticipantId) {
          ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
          return;
        }

        const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
        const partnerSocketId = voiceSocketByKey.get(partnerKey);

        console.log('[CoffeeVoice] Voice call request initiated', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          initiatorParticipantId: initiator.participantId,
          partnerParticipantId,
          partnerConnected: !!partnerSocketId,
        });

        // Emit confirmation modal to initiator
        socket.emit('coffee:voice_call_modal', {
          type: 'initiator',
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          partnerParticipantId,
          partnerName: initiatorSide === 'person1' ? pair.person2?.name : pair.person1?.name,
          partnerAvatar: initiatorSide === 'person1' ? pair.person2?.avatar : pair.person1?.avatar,
          message: 'Ready to start a voice call?',
        });

        // Emit request modal to partner — always broadcast to game room with toParticipantId
        // so delivery works even after reconnects (voiceSocketByKey can be stale). Client filters.
        const receiverModal = {
          type: 'receiver' as const,
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          initiatorParticipantId: initiator.participantId,
          initiatorName: initiatorSide === 'person1' ? pair.person1?.name : pair.person2?.name,
          initiatorAvatar: initiatorSide === 'person1' ? pair.person1?.avatar : pair.person2?.avatar,
          message: 'wants to start a voice call with you',
          toParticipantId: partnerParticipantId, // Client filters: only partner shows modal
        };
        const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${partnerParticipantId}`;
        pendingVoiceCallRequests.set(pendingKey, {
          modal: receiverModal,
          createdAt: Date.now(),
        });

        const roomId = `game:${validation.data.sessionId}`;
        gamesNs.to(roomId).emit('coffee:voice_call_modal', receiverModal);
        console.log('[CoffeeVoice] Voice call modals sent', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          partnerParticipantId,
          roomId,
        });

        ack?.({ ok: true, partnerConnected: !!partnerSocketId });
      } catch (err) {
        console.error('[CoffeeVoice] voice_call_request error:', err);
        ack?.({ ok: false, error: 'VOICE_CALL_REQUEST_ERROR' });
      }
    });

    // ─── Coffee Roulette Voice Call Response (Accept/Decline) ───
    // When a partner responds to the voice call modal
    socket.on('coffee:voice_call_response', async (data: unknown, ack) => {
      const validation = z.object({
        sessionId: z.string().uuid('Invalid session ID'),
        pairId: z.string().uuid('Invalid pair ID'),
        accepted: z.boolean(),
      }).safeParse(data);

      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const responder = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!responder) {
          console.warn('[CoffeeVoice] voice_call_response: responder not a participant', {
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

        // Verify responder is in this pair
        const isInPair = 
          pair.person1?.participantId === responder.participantId ||
          pair.person2?.participantId === responder.participantId;

        if (!isInPair) {
          ack?.({ ok: false, error: 'NOT_IN_PAIR' });
          return;
        }

        const initiatorParticipantId =
          pair.person1?.participantId === responder.participantId 
            ? pair.person2?.participantId 
            : pair.person1?.participantId;

        if (!initiatorParticipantId) {
          ack?.({ ok: false, error: 'INITIATOR_NOT_FOUND' });
          return;
        }

        const initiatorKey = `${validation.data.sessionId}:${initiatorParticipantId}`;
        const initiatorSocketId = voiceSocketByKey.get(initiatorKey);

        console.log('[CoffeeVoice] Voice call response received', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          responderParticipantId: responder.participantId,
          initiatorParticipantId,
          accepted: validation.data.accepted,
          initiatorConnected: !!initiatorSocketId,
        });

        if (validation.data.accepted) {
          const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${responder.participantId}`;
          pendingVoiceCallRequests.delete(pendingKey);
          // Partner accepted - close modals on both sides and proceed with voice setup
          socket.emit('coffee:voice_call_accepted', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
          });

          if (initiatorSocketId) {
            gamesNs.to(initiatorSocketId).emit('coffee:voice_call_accepted', {
              sessionId: validation.data.sessionId,
              pairId: validation.data.pairId,
            });

            console.log('[CoffeeVoice] Voice call accepted - both modals will close', {
              sessionId: validation.data.sessionId,
              pairId: validation.data.pairId,
            });
          }
        } else {
          const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${responder.participantId}`;
          pendingVoiceCallRequests.delete(pendingKey);
          // Partner declined - notify initiator
          socket.emit('coffee:voice_call_declined', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
          });

          if (initiatorSocketId) {
            gamesNs.to(initiatorSocketId).emit('coffee:voice_call_declined', {
              sessionId: validation.data.sessionId,
              pairId: validation.data.pairId,
            });

            console.log('[CoffeeVoice] Voice call declined', {
              sessionId: validation.data.sessionId,
              pairId: validation.data.pairId,
            });
          }
        }

        ack?.({ ok: true });
      } catch (err) {
        console.error('[CoffeeVoice] voice_call_response error:', err);
        ack?.({ ok: false, error: 'VOICE_CALL_RESPONSE_ERROR' });
      }
    });

    // ─── Coffee Roulette Voice Call Cancel ───
    // Sent by the initiator when they close/cancel their pending call request.
    // Notifies the receiver so their modal closes immediately instead of timing out.
    socket.on('coffee:voice_call_cancel', async (data: unknown, ack) => {
      const validation = z.object({
        sessionId: z.string().uuid('Invalid session ID'),
        pairId: z.string().uuid('Invalid pair ID'),
      }).safeParse(data);

      if (!validation.success) {
        ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
      }

      try {
        const canceller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
        if (!canceller) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
        const state = latest?.state as any;
        const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
        if (!pair) {
          ack?.({ ok: false, error: 'PAIR_NOT_FOUND' });
          return;
        }

        const cancellerSide = pair.person1?.participantId === canceller.participantId ? 'person1' : 'person2';
        const partnerParticipantId =
          cancellerSide === 'person1' ? pair.person2?.participantId : pair.person1?.participantId;

        if (partnerParticipantId) {
          const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${partnerParticipantId}`;
          pendingVoiceCallRequests.delete(pendingKey);
          const cancelPayload = {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            toParticipantId: partnerParticipantId, // Client filters: only partner closes modal
          };
          gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_cancelled', cancelPayload);
        }

        ack?.({ ok: true });
      } catch (err) {
        console.error('[CoffeeVoice] voice_call_cancel error:', err);
        ack?.({ ok: false, error: 'VOICE_CALL_CANCEL_ERROR' });
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
    socket.on('disconnect', async (_reason) => {

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

          coffeeActionQueue.set(
            sessionId,
            run
              .then(() => undefined)
              .catch((err) => {
                // ⚠️ CRITICAL: Log async cleanup action errors instead of swallowing them
                console.error('[GameCleanup] Async action failed:', {
                  sessionId,
                  participantId,
                  error: err instanceof Error ? err.message : String(err),
                  stack: err instanceof Error ? err.stack : undefined,
                });
                // Re-throw to maintain promise chain integrity
                throw err;
              })
          );
          void run;
        }
      }
      joinedSessions.clear();
      joinedParticipantBySessionId.clear();
    });
  });
}
