/**
 * Game namespace handlers — sessions, rounds, actions with DB persistence.
 */
import { Namespace } from 'socket.io';
import { z } from 'zod';
import { AuthenticatedSocket } from './types';
import { checkRateLimit } from './index';
import { GamesService } from '../services/games.service';
import { query, queryOne, transaction } from '../config/database';
import crypto from 'crypto';

const gamesService = new GamesService();

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
  return actionType.startsWith('strategic:');
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
  scores: Record<string, number>;
  submitEndsAt?: string;
  voteEndsAt?: string;
};

async function reduceTwoTruthsState(args: {
  eventId: string;
  participantId: string;
  actionType: string;
  payload: any;
  prev: TwoTruthsState | null;
}): Promise<TwoTruthsState> {
  const { eventId, participantId, actionType, payload, prev } = args;

  const base: TwoTruthsState = prev || {
    kind: 'two-truths',
    phase: 'waiting',
    round: 1,
    totalRounds: 4,
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
      totalRounds: Number(payload?.totalRounds) || base.totalRounds,
      statements: null,
      votes: {},
      revealedLie: null,
      submitEndsAt: new Date(Date.now() + 30000).toISOString(),
    };
  }

  if (actionType === 'two_truths:submit') {
    const statements: string[] = Array.isArray(payload?.statements) ? payload.statements : [];
    const normalized = [
      { id: 's0' as const, text: String(statements[0] || '').slice(0, 300) },
      { id: 's1' as const, text: String(statements[1] || '').slice(0, 300) },
      { id: 's2' as const, text: String(statements[2] || '').slice(0, 300) },
    ];
    const ready = normalized.every(s => s.text.trim().length > 0);
    if (!ready) return base;
    return {
      ...base,
      phase: 'vote',
      presenterParticipantId: participantId,
      statements: normalized,
      votes: {},
      revealedLie: null,
      voteEndsAt: new Date(Date.now() + 20000).toISOString(),
    };
  }

  if (actionType === 'two_truths:vote') {
    const choice = payload?.statementId;
    if (!['s0', 's1', 's2'].includes(choice)) return base;
    if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;
    return { ...base, votes: { ...base.votes, [participantId]: choice } };
  }

  if (actionType === 'two_truths:reveal') {
    const lie: 's0' | 's1' | 's2' = (['s0', 's1', 's2'].includes(payload?.lieId) ? payload.lieId : 's2');
    
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
      submitEndsAt: new Date(Date.now() + 30000).toISOString(),
    };
  }

  return base;
}

type CoffeeState = {
  kind: 'coffee-roulette';
  phase: 'waiting' | 'matching' | 'chatting' | 'complete';
  pairs: Array<{
    id: string;
    person1: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    person2: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    topic: string;
  }>;
  startedChatAt: string | null;
  chatEndsAt?: string;
};

const COFFEE_TOPICS = [
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

async function reduceCoffeeState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: CoffeeState | null;
}): Promise<CoffeeState> {
  const { eventId, actionType, prev } = args;

  const base: CoffeeState = prev || { kind: 'coffee-roulette', phase: 'waiting', pairs: [], startedChatAt: null };

  if (actionType === 'coffee:shuffle') {
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
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const pairs: CoffeeState['pairs'] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) break;
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      pairs.push({
        id: String(i / 2),
        person1: { participantId: p1.id, name: p1.name, avatar: (p1.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p1.avatar || null },
        person2: { participantId: p2.id, name: p2.name, avatar: (p2.name || '??').slice(0, 2).toUpperCase(), avatarUrl: p2.avatar || null },
        topic: COFFEE_TOPICS[Math.floor(Math.random() * COFFEE_TOPICS.length)],
      });
    }
    return { ...base, phase: 'matching', pairs, startedChatAt: null };
  }

  if (actionType === 'coffee:start_chat') {
    const chatDurationMinutes = 30; // Using 30 minutes chat limit
    return { 
      ...base, 
      phase: 'chatting', 
      startedChatAt: new Date().toISOString(),
      chatEndsAt: new Date(Date.now() + chatDurationMinutes * 60000).toISOString()
    };
  }

  if (actionType === 'coffee:end') {
    return { ...base, phase: 'complete' };
  }

  if (actionType === 'coffee:reset') {
    return { kind: 'coffee-roulette', phase: 'waiting', pairs: [], startedChatAt: null };
  }

  return base;
}

type StrategicState = {
  kind: 'strategic-escape';
  phase: 'setup' | 'roles_assignment' | 'pre_discussion' | 'discussion' | 'debrief';
  industry: string;
  crisisType: string;
  difficulty: string;
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
    industry: payload?.industry || 'strategic.industries.tech_saas',
    crisisType: payload?.crisisType || 'strategic.crises.product_launch_crisis',
    difficulty: payload?.difficulty || 'medium',
    rolesAssigned: false,
  };

  if (actionType === 'strategic:configure') {
    return {
      ...base,
      industry: payload?.industry || base.industry,
      crisisType: payload?.crisisType || base.crisisType,
      difficulty: payload?.difficulty || base.difficulty,
      phase: 'setup',
    };
  }

  if (actionType === 'strategic:assign_roles') {
    return {
      ...base,
      rolesAssigned: true,
      phase: 'roles_assignment',
    };
  }

  if (actionType === 'strategic:start_discussion') {
    const minutes = typeof payload?.durationMinutes === 'number' ? payload.durationMinutes : 45;
    return {
      ...base,
      phase: 'discussion',
      discussionEndsAt: new Date(Date.now() + minutes * 60000).toISOString(),
    };
  }

  if (actionType === 'strategic:end_discussion') {
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
    await query(
      `INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
       VALUES ($1, $2, $3, 'member', NOW(), NOW())`,
      [participantId, orgMember.event_id, orgMember.id]
    );
    return { participantId };
  }

  return null;
}

/** Check if user has admin/moderator role in the event's org */
async function isEventAdmin(sessionId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT r.name FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [sessionId, userId]
  );
  return row && ['owner', 'admin', 'moderator'].includes(row.name);
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

        const session = await gamesService.getSession(data.sessionId);
        const activeRound = await gamesService.getActiveRound(data.sessionId);
        const snapshot = await gamesService.getLatestSnapshot(data.sessionId);
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
            activeRoundId: activeRound?.id || null,
            participantId: participant.participantId,
            snapshot: snapshot?.state || null,
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
        // BUG FIX: Only org admins/moderators can start games
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
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
        // BUG FIX: Only admins can start rounds
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
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
      if (!(await checkRateLimit(socket, 'game:action'))) return;

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

        // Shared game snapshots for supported games
        const gameKey = await getSessionGameKey(data.sessionId);
        const latest = await gamesService.getLatestSnapshot(data.sessionId);
        const session = await gamesService.getSession(data.sessionId);

        if (gameKey === 'two-truths' && isTwoTruthsAction(data.actionType)) {
          const next = await reduceTwoTruthsState({
            eventId: session.event_id,
            participantId: participant.participantId,
            actionType: data.actionType,
            payload: data.payload,
            prev: (latest?.state as any) || null,
          });
          await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', { sessionId: data.sessionId, gameData: next });
        }

        if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
          const next = await reduceCoffeeState({
            eventId: session.event_id,
            actionType: data.actionType,
            payload: data.payload,
            prev: (latest?.state as any) || null,
          });
          await gamesService.saveSnapshot(data.sessionId, next);
          gamesNs.to(`game:${data.sessionId}`).emit('game:data', { sessionId: data.sessionId, gameData: next });
        }

        if (gameKey === 'strategic-escape' && isStrategicAction(data.actionType)) {
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
        // BUG FIX: Only admins can end rounds, and persist to DB with transaction
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
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
        // BUG FIX: Only admins can end games
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
          socket.emit('error', { message: 'Only event administrators can end games', code: 'FORBIDDEN' });
          return;
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

        const session = await gamesService.getSession(data.sessionId);
        const activeRound = await gamesService.getActiveRound(data.sessionId);
        const snapshot = await gamesService.getLatestSnapshot(data.sessionId);
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
