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
  };

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
      submitEndsAt: new Date(Date.now() + 30000).toISOString(),
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
      voteEndsAt: new Date(Date.now() + 20000).toISOString(),
    };
  }

  if (actionType === 'two_truths:vote') {
    // Guard: only accept votes during vote phase
    if (base.phase !== 'vote') return base;
    const choice = payload?.statementId;
    if (!['s0', 's1', 's2'].includes(choice)) return base;
    if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;
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
      scores: updatedScores 
    };
  }

  if (actionType === 'two_truths:next_round') {
    const nextRound = base.round + 1;
    if (nextRound > base.totalRounds) return { ...base, phase: 'results' };

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
      submitEndsAt: new Date(Date.now() + 30000).toISOString(),
    };
  }

  return base;
}

type CoffeeState = {
  kind: 'coffee-roulette';
  phase: 'waiting' | 'matching' | 'chatting' | 'complete';
  configId?: string; // ID of the coffee roulette configuration for this event
  pairs: Array<{
    id: string;
    person1: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    person2: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    topic: string;
    topicId?: string; // ID of the selected topic
    sessionId?: string; // Pair session ID for tracking
  }>;
  startedChatAt: string | null;
  chatEndsAt?: string;
  /** Number of conversation prompts used in the current chat session */
  promptsUsed: number;
  /** When true, clients should ask whether to continue or end */
  decisionRequired: boolean;
  /** Track questions used in session */
  usedQuestionIndices?: number[];
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
          text: selectedTopic.title || 'Let\'s chat!',
          id: selectedTopic.id,
        };
      }
    }
  } catch (error) {
    console.error('Error selecting dynamic topic:', error);
  }

  // Fallback to default topics if no configuration or selection failed
  const FALLBACK_TOPICS = [
    "What's the most interesting thing you've learned recently?",
    "If you could have dinner with anyone (alive or dead), who would it be?",
    "What's a hobby or skill you'd love to pick up?",
    "What was your first job? What did you learn from it?",
    "If you could live anywhere in the world for a year, where would you go?",
    "What's the best piece of advice you've ever received?",
    "What's a book or movie that completely changed your perspective?",
    "If you had to eat one meal for the rest of your life, what would it be?",
    "What's the most spontaneous thing you've ever done?",
    "Which fictional character do you relate to the most?",
    "What's something you're surprisingly good at?",
  ];

  const randomTopic = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
  return { text: randomTopic };
}

async function reduceCoffeeState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: CoffeeState | null;
}): Promise<CoffeeState> {
  const { eventId, actionType, prev } = args;

  const base: CoffeeState = prev || {
    kind: 'coffee-roulette',
    phase: 'waiting',
    pairs: [],
    startedChatAt: null,
    promptsUsed: 0,
    decisionRequired: false,
  };

  if (actionType === 'coffee:shuffle') {
    // Get configuration ID for the event
    const configRow = await queryOne(
      'SELECT id FROM coffee_roulette_config WHERE event_id = $1',
      [eventId]
    );

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

    // Deduplicate participants to prevent a single user (e.g. guest from multiple tabs) from matching with themselves.
    // We consider it the same person if they share the same display name and avatar payload.
    const seenUsers = new Set<string>();
    const uniqueParticipants = participants.filter(p => {
      const key = `${p.name.trim().toLowerCase()}||${p.avatar || ''}`;
      if (seenUsers.has(key)) return false;
      seenUsers.add(key);
      return true;
    });

    // Guard: need at least 2 unique participants to form pairs
    if (uniqueParticipants.length < 2) {
      return { ...base, phase: 'waiting', pairs: [], startedChatAt: null };
    }

    // Fisher-Yates shuffle for unbiased randomisation
    const shuffled = [...uniqueParticipants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const pairs: CoffeeState['pairs'] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) break;
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      const pairId = crypto.randomUUID();
      
      // Get dynamic topic for the pair
      const topicData = await getDynamicTopic(eventId);
      
      pairs.push({
        id: pairId,
        person1: { participantId: p1.id, name: p1.name, avatar: (p1.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p1.avatar || null },
        person2: { participantId: p2.id, name: p2.name, avatar: (p2.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p2.avatar || null },
        topic: topicData.text,
        topicId: topicData.id,
      });
    }
    return {
      ...base,
      configId: configRow?.id,
      phase: 'matching',
      pairs,
      startedChatAt: null,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:start_chat') {
    // Idempotent: if chat already started, ignore duplicates (prevents timer resets
    // when multiple clients emit automatically on 'matching').
    if (base.startedChatAt) return base;
    const chatDurationMinutes = 30; // Using 30 minutes chat limit
    return { 
      ...base, 
      phase: 'chatting', 
      startedChatAt: new Date().toISOString(),
      chatEndsAt: new Date(Date.now() + chatDurationMinutes * 60000).toISOString(),
      // Start with 1 prompt already assigned on shuffle
      promptsUsed: Math.max(1, base.promptsUsed || 0),
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:next_prompt') {
    // Only relevant during an active chat
    if (base.phase !== 'chatting') return base;

    const nextPromptsUsed = (base.promptsUsed || 0) + 1;
    const shouldAsk = nextPromptsUsed >= 6;

    // Get new topics for all pairs from dynamic configuration
    const updatedPairs = await Promise.all(
      (base.pairs || []).map(async (pair) => ({
        ...pair,
        topic: (await getDynamicTopic(eventId)).text,
      }))
    );

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
    return {
      ...base,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:end') {
    return { ...base, phase: 'complete' };
  }

  if (actionType === 'coffee:end_and_finish') {
    return { ...base, phase: 'complete' };
  }

  if (actionType === 'coffee:reset') {
    return {
      kind: 'coffee-roulette',
      phase: 'waiting',
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
  discussionEndsAt?: string;
};

async function reduceStrategicState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: StrategicState | null;
}): Promise<StrategicState> {
  const { actionType, payload, prev } = args;

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
    };
  }

  if (actionType === 'strategic:assign_roles') {
    // Idempotent: don't re-run assignment transitions
    if (base.rolesAssigned) return base;
    return {
      ...base,
      rolesAssigned: true,
      phase: 'roles_assignment',
    };
  }

  if (actionType === 'strategic:start_discussion') {
    // Idempotent: don't reset discussion timer if already started
    if (base.phase === 'discussion' && base.discussionEndsAt) return base;
    const minutes = typeof payload?.durationMinutes === 'number' ? payload.durationMinutes : 45;
    return {
      ...base,
      phase: 'discussion',
      discussionEndsAt: new Date(Date.now() + minutes * 60000).toISOString(),
    };
  }

  if (actionType === 'strategic:end_discussion') {
    // Idempotent: repeated end should not change anything
    if (base.phase === 'debrief') return base;
    return {
      ...base,
      phase: 'debrief',
    };
  }

  return base;
}

/** Verify the user is a participant in the game session's event and return their participant ID */
async function verifyGameParticipant(sessionId: string, userId: string, socket?: AuthenticatedSocket): Promise<{ participantId: string } | null> {
  // If this is a guest socket, use the guest payload directly
  if (socket?.isGuest && socket.guestPayload) {
    const guestRow = await queryOne<{ id: string }>(
      `SELECT p.id FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [sessionId, socket.guestPayload.participantId]
    );
    return guestRow ? { participantId: guestRow.id } : null;
  }

  // Authenticated user: match via organization_members
  const row = await queryOne<{ id: string }>(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN game_sessions gs ON gs.event_id = p.event_id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending') AND p.left_at IS NULL`,
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
  gamesNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;
    console.log(`[Games] User ${user.userId} connected`);

    const joinedSessions = new Set<string>();

    // ─── Join game session room ───
    socket.on('game:join', async (data: { sessionId: string }, ack) => {
      const validation = gameJoinSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        ack?.({ ok: false, error: 'Invalid session ID' });
        return;
      }

      try {
        // BUG FIX: Verify user is a participant in the event before joining
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          ack?.({ ok: false, error: 'Not a participant' });
          return;
        }

        const [session, activeRound, snapshot, admin] = await Promise.all([
          gamesService.getSession(data.sessionId),
          gamesService.getActiveRound(data.sessionId),
          gamesService.getLatestSnapshot(data.sessionId),
          canControlGameFlow(data.sessionId, user.userId, socket).catch(() => false),
        ]);
        const roomId = `game:${data.sessionId}`;
        socket.join(roomId);
        joinedSessions.add(data.sessionId);

        // Notify others
        socket.to(roomId).emit('game:player_joined', {
          userId: user.userId,
          participantId: participant.participantId,
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

          ack?.({
            ok: true,
            data: {
              status: session.status,
              currentRound: session.current_round,
              totalRounds: session.total_rounds || 4,
              activeRoundId: activeRound?.id || null,
              participantId: participant.participantId,
              snapshot: snapshot?.state || null,
              // "Admin" here means "can control game flow" for UI purposes.
              isAdmin: !!admin,
            },
          });
      } catch (err: any) {
        console.error(`[Games] game:join error:`, err.message);
        socket.emit('error', { message: err.message, code: 'JOIN_ERROR' });
        ack?.({ ok: false, error: err.message });
      }
    });

    // ─── Leave game session ───
    socket.on('game:leave', (data: { sessionId: string }) => {
      const validation = gameRoundSchema.safeParse(data);
      if (!validation.success) return;
      const roomId = `game:${data.sessionId}`;
      socket.leave(roomId);
      joinedSessions.delete(data.sessionId);

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
      const validation = gameActionSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        // BUG FIX: Resolve participant ID from authenticated user instead of trusting client
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          return;
        }

        const activeRound = await gamesService.getActiveRound(data.sessionId);
        const roundId = data.roundId || activeRound?.id;
        if (!roundId) {
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

          await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', { sessionId: data.sessionId, gameData: publiclySafeState });
        }

        if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
          const normalizedAction =
            data.actionType === 'coffee:end_and_finish' ? 'coffee:end' : data.actionType;

          const next = await reduceCoffeeState({
            eventId: session.event_id,
            actionType: normalizedAction,
            payload: data.payload,
            prev: (latest?.state as any) || null,
          });

          await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', { sessionId: data.sessionId, gameData: next });

          // If requested, also close the DB session and broadcast game:ended.
          if (data.actionType === 'coffee:end_and_finish') {
            const { results } = await gamesService.finishSession(data.sessionId);
            gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
              sessionId: data.sessionId,
              results,
              timestamp: new Date().toISOString(),
            });
          }
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
          });
          await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', { sessionId: data.sessionId, gameData: next });
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

        const { results } = await gamesService.finishSession(data.sessionId, finalScores);

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
            activeRoundId: activeRound?.id || null,
            snapshot: snapshot?.state || null,
          },
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'STATE_ERROR' });
      }
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', (reason) => {
      console.log(`[Games] User ${user.userId} disconnected: ${reason}`);

      for (const sessionId of joinedSessions) {
        socket.to(`game:${sessionId}`).emit('game:player_left', {
          userId: user.userId,
          sessionId,
          timestamp: new Date().toISOString(),
        });
      }
      joinedSessions.clear();
    });
  });
}
