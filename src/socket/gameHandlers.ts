/**
 * Game namespace handlers — thin orchestrator.
 * All logic is delegated to focused sub-handlers in ./game-handlers/.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { GamesService } from '../services/games.service';
import { isTwoTruthsAction, isCoffeeAction } from '../games/actionPredicates';
import { getSessionGameKey } from './game-handlers/sessionGameKey';
import { gameActionSchema } from './game-handlers/schemas';
import { verifyGameParticipant } from './game-handlers/participantAccess';

import type { GameHandlerContext, VoiceCaches, ActionQueues, PerSocketState } from './game-handlers/handlerContext';
import { registerSessionLifecycleHandlers } from './game-handlers/sessionLifecycleHandlers';
import { registerCoffeeVoiceHandlers } from './game-handlers/coffeeVoiceHandlers';
import { handleTwoTruthsAction } from './game-handlers/twoTruthsActionHandler';
import { handleCoffeeAction } from './game-handlers/coffeeActionHandler';
import { handleStrategicAction } from './game-handlers/strategicActionHandler';

const gamesService = new GamesService();

export function setupGameHandlers(gamesNs: Namespace) {
  // Shared caches (namespace-wide, not per-socket)
  const voiceCaches: VoiceCaches = {
    voiceSocketByKey: new Map(),
    voiceKeysBySocket: new Map(),
    coffeeVoiceOfferCache: new Map(),
    pendingVoiceCallRequests: new Map(),
    pendingVoiceSignals: new Map(),
    COFFEE_VOICE_OFFER_TTL_MS: 35 * 60 * 1000,
    COFFEE_VOICE_CALL_REQUEST_TTL_MS: 45 * 1000,
  };

  const actionQueues: ActionQueues = {
    coffeeActionQueue: new Map(),
    twoTruthsActionQueue: new Map(),
    strategicActionQueue: new Map(),
  };

  // Proactive eviction of expired cache entries every 10 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of voiceCaches.coffeeVoiceOfferCache) {
      if (now - entry.createdAt > voiceCaches.COFFEE_VOICE_OFFER_TTL_MS) {
        voiceCaches.coffeeVoiceOfferCache.delete(key);
      }
    }
    for (const [key, entry] of voiceCaches.pendingVoiceCallRequests) {
      if (now - entry.createdAt > voiceCaches.COFFEE_VOICE_CALL_REQUEST_TTL_MS) {
        voiceCaches.pendingVoiceCallRequests.delete(key);
      }
    }
    for (const [key, entries] of voiceCaches.pendingVoiceSignals) {
      const freshEntries = entries.filter(entry => now - entry.createdAt <= voiceCaches.COFFEE_VOICE_OFFER_TTL_MS);
      if (freshEntries.length > 0) {
        voiceCaches.pendingVoiceSignals.set(key, freshEntries);
      } else {
        voiceCaches.pendingVoiceSignals.delete(key);
      }
    }
  }, 10 * 60 * 1000);

  gamesNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;

    const perSocket: PerSocketState = {
      joinedSessions: new Set(),
      joinedParticipantBySessionId: new Map(),
    };

    const ctx: GameHandlerContext = {
      gamesNs,
      socket,
      user,
      gamesService,
      perSocket,
      voiceCaches,
      actionQueues,
    };

    // Register all sub-handlers
    registerSessionLifecycleHandlers(ctx);
    registerCoffeeVoiceHandlers(ctx);

    // ─── Player action (dispatches to game-specific handler) ───
    socket.on('game:action', async (data: { sessionId: string; roundId?: string; actionType: string; payload: any }, ack?: Function) => {
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
        ack?.({ ok: false, error: validation.error.issues[0].message, code: 'VALIDATION' });
        return;
      }

      try {
        // Resolve participant (cached from game:join or fresh lookup)
        let participant: { participantId: string } | null = null;
        const cachedParticipantId = perSocket.joinedParticipantBySessionId.get(data.sessionId);
        if (cachedParticipantId) {
          participant = { participantId: cachedParticipantId };
        } else {
          participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
          if (participant) perSocket.joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
        }
        if (!participant) {
          console.warn('[GameAction] Participant verification failed', { sessionId: data.sessionId, userId: user.userId });
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          ack?.({ ok: false, error: 'Not a participant', code: 'FORBIDDEN' });
          return;
        }

        const roundId = data.roundId || (await gamesService.getActiveRound(data.sessionId))?.id || null;

        const [gameKey, session] = await Promise.all([
          getSessionGameKey(data.sessionId),
          gamesService.getSession(data.sessionId),
        ]);

        // roundId is required for non-coffee games
        const isCoffeeGame = gameKey === 'coffee-roulette';
        if (!roundId && !isCoffeeGame) {
          console.warn('[GameAction] No active round found', { sessionId: data.sessionId });
          socket.emit('error', { message: 'No active round for this session', code: 'ROUND_NOT_ACTIVE' });
          ack?.({ ok: false, error: 'No active round', code: 'ROUND_NOT_ACTIVE' });
          return;
        }

        console.log('[GameAction] Dispatching to handler', {
          gameKey,
          actionType: data.actionType,
          sessionId: data.sessionId,
          roundId: roundId || 'null',
          participantId: participant.participantId,
        });

        // Dispatch to game-specific handler (ack is forwarded for immediate response)
        if (gameKey === 'two-truths' && isTwoTruthsAction(data.actionType)) {
          await handleTwoTruthsAction({ ctx, data, participant, roundId: roundId!, session, ack });
        } else if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
          await handleCoffeeAction({ ctx, data, participant, roundId, session, ack });
        } else if (gameKey === 'strategic-escape') {
          await handleStrategicAction({ ctx, data, participant, session, ack });
        } else {
          // Generic fallback for non-game-specific actions
          if (!roundId) {
            socket.emit('error', { message: 'No active round for this session', code: 'ROUND_NOT_ACTIVE' });
            ack?.({ ok: false, error: 'No active round', code: 'ROUND_NOT_ACTIVE' });
            return;
          }
          const action = await gamesService.submitAction(
            data.sessionId,
            roundId,
            participant.participantId,
            data.actionType,
            data.payload || {},
          );

          gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
            userId: user.userId,
            participantId: participant.participantId,
            actionType: data.actionType,
            payload: data.payload,
            timestamp: action.created_at,
          });
          ack?.({ ok: true });
        }
      } catch (err: any) {
        console.error(`[Games] game:action error:`, err.message);
        socket.emit('error', { message: err.message, code: 'ACTION_ERROR' });
        ack?.({ ok: false, error: err.message, code: 'ACTION_ERROR' });
      }
    });
  });
}
