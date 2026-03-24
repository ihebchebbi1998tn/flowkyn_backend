/**
 * Game namespace handlers — sessions, rounds, actions with DB persistence.
 * Shared socket utilities: ./game-handlers/. Per-game reducers/schemas: ../games/<key>/.
 */
import { Namespace } from 'socket.io';
import { z } from 'zod';
import { AuthenticatedSocket } from './types';
import { GamesService } from '../services/games.service';
import { query, queryOne, transaction } from '../config/database';
import { emitEventNotification } from './emitter';

import { logAuditEvent } from './game-handlers/audit';
import { toSnapshotCreatedAt } from './game-handlers/snapshotUtils';
import { isTwoTruthsAction, isCoffeeAction, isStrategicAction } from '../games/actionPredicates';
import { getSessionGameKey } from './game-handlers/sessionGameKey';
import {
  gameJoinSchema,
  gameRoundSchema,
  gameRoundNumberSchema,
  gameActionSchema,
  gameRoundEndSchema,
  gameEndSchema,
  gameStateSyncSchema,
  coffeeVoiceOfferSchema,
  coffeeVoiceAnswerSchema,
  coffeeVoiceIceCandidateSchema,
  coffeeVoiceRequestOfferSchema,
  coffeeVoiceHangupSchema,
  twoTruthsSubmitSchema,
  twoTruthsVoteSchema,
  twoTruthsRevealSchema,
  coffeeNextPromptSchema,
  coffeeContinueSchema,
  strategicConfigureSchema,
  strategicAssignRolesSchema,
} from './game-handlers/schemas';
import { verifyGameParticipant, canControlGameFlow } from './game-handlers/participantAccess';
import { enrichCoffeeSnapshotForLateJoiner } from '../games/coffee-roulette/lateJoiner';
import {
  sanitizeTwoTruthsStateForPublic,
  reduceTwoTruthsState,
  type TwoTruthsState,
} from '../games/two-truths/reducer';
import { reduceCoffeeState } from '../games/coffee-roulette/reducer';
import { reduceStrategicState } from '../games/strategic-escape/reducer';

const gamesService = new GamesService();

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

          const snapshotForClient = enrichedSnapshot
            ? sanitizeTwoTruthsStateForPublic(enrichedSnapshot)
            : null;

          ack?.({
            ok: true,
            data: {
              status: session.status,
              currentRound: session.current_round,
              totalRounds: session.total_rounds || 4,
              activeRoundId: activeRound?.id || null,
              participantId: participant.participantId,
              snapshot: snapshotForClient,
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

        const [gameKey, session] = await Promise.all([
          getSessionGameKey(data.sessionId),
          gamesService.getSession(data.sessionId),
        ]);

        if (gameKey === 'two-truths' && isTwoTruthsAction(data.actionType)) {
          // Reveal / next round: only the participant who submitted this round’s statements (not event admins).
          const PRESENTER_ACTIONS = new Set(['two_truths:reveal', 'two_truths:next_round']);
          if (PRESENTER_ACTIONS.has(data.actionType)) {
            const latest = await gamesService.getLatestSnapshot(data.sessionId);
            const st = latest?.state as TwoTruthsState | null;
            if (st?.kind !== 'two-truths' || !st.presenterParticipantId) {
              socket.emit('error', {
                message: 'Game state is not ready for that action.',
                code: 'FORBIDDEN',
              });
              return;
            }
            if (st.presenterParticipantId !== participant.participantId) {
              socket.emit('error', {
                message: 'Only the person who submitted this round’s statements can do that.',
                code: 'FORBIDDEN',
              });
              return;
            }
            if (data.actionType === 'two_truths:reveal' && st.phase !== 'vote') {
              socket.emit('error', { message: 'Reveal is only available during voting.', code: 'FORBIDDEN' });
              return;
            }
            if (data.actionType === 'two_truths:next_round' && st.phase !== 'reveal') {
              socket.emit('error', {
                message: 'Finish the reveal before starting the next round.',
                code: 'FORBIDDEN',
              });
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
              activeRoundId: roundId,
            });

            const publiclySafeState = sanitizeTwoTruthsStateForPublic(next);

            const savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
            gamesNs.to(`game:${data.sessionId}`).emit('game:data', {
              sessionId: data.sessionId,
              gameData: publiclySafeState,
              snapshotRevisionId: savedSnapshot?.id || null,
              snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
            });

            // Redundant broadcast on the events namespace to reliably wake up
            // clients that haven't joined the game room yet.
            if (data.actionType === 'two_truths:start' && next.phase === 'submit') {
              emitEventNotification(session.event_id, 'game:session_created', {
                sessionId: data.sessionId,
              });
            }

            return savedSnapshot;
          });

          twoTruthsActionQueue.set(
            data.sessionId,
            ttRun.then(() => undefined).catch(() => undefined),
          );

          let savedSnapshot: Awaited<typeof ttRun>;
          try {
            savedSnapshot = await ttRun;
          } catch (ttErr: any) {
            console.error('[Games] two-truths snapshot/vote failed:', ttErr?.message || ttErr);
            socket.emit('error', { message: ttErr?.message || 'Game action failed', code: 'ACTION_ERROR' });
            return;
          }

          let action: { created_at: Date };
          try {
            action = await gamesService.submitAction(
              data.sessionId,
              roundId,
              participant.participantId,
              data.actionType,
              data.payload || {}
            );
          } catch (submitErr: any) {
            console.error('[Games] two-truths submitAction after snapshot:', submitErr?.message || submitErr);
            socket.emit('error', {
              message: submitErr?.message || 'Failed to persist action',
              code: (submitErr as any)?.code || 'ACTION_ERROR',
            });
            return;
          }

          gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
            userId: user.userId,
            participantId: participant.participantId,
            actionType: data.actionType,
            payload: data.payload,
            timestamp: action.created_at,
          });

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
        } else {
          const action = await gamesService.submitAction(
            data.sessionId,
            roundId,
            participant.participantId,
            data.actionType,
            data.payload || {}
          );

          gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
            userId: user.userId,
            participantId: participant.participantId,
            actionType: data.actionType,
            payload: data.payload,
            timestamp: action.created_at,
          });

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
        const snapshotState = snapshot?.state
          ? sanitizeTwoTruthsStateForPublic(snapshot.state)
          : null;
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
            snapshot: snapshotState,
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

        console.log('[CoffeeVoice] Voice call response received', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          responderParticipantId: responder.participantId,
          initiatorParticipantId,
          accepted: validation.data.accepted,
          roomId: `game:${validation.data.sessionId}`,
        });

        if (validation.data.accepted) {
          const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${responder.participantId}`;
          pendingVoiceCallRequests.delete(pendingKey);
          // Partner accepted - close modals on both sides and proceed with voice setup
          socket.emit('coffee:voice_call_accepted', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
          });

          // Notify initiator via room broadcast + toParticipantId filtering
          gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_accepted', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            toParticipantId: initiatorParticipantId,
          });

          console.log('[CoffeeVoice] Voice call accepted - initiator notified via room broadcast', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            toParticipantId: initiatorParticipantId,
          });
        } else {
          const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${responder.participantId}`;
          pendingVoiceCallRequests.delete(pendingKey);
          // Partner declined - notify initiator
          socket.emit('coffee:voice_call_declined', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
          });

          // Notify initiator via room broadcast + toParticipantId filtering
          gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_declined', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            toParticipantId: initiatorParticipantId,
          });

          console.log('[CoffeeVoice] Voice call declined', {
            sessionId: validation.data.sessionId,
            pairId: validation.data.pairId,
            toParticipantId: initiatorParticipantId,
          });
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
