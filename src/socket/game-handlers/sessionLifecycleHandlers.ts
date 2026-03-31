/**
 * Session lifecycle handlers: join, leave, start, round_start, round_end, end, state_sync, disconnect.
 */
import type { GameHandlerContext } from './handlerContext';
import { queryOne, query, transaction } from '../../config/database';
import { toSnapshotCreatedAt } from './snapshotUtils';
import { getSessionGameKey } from './sessionGameKey';
import {
  gameJoinSchema,
  gameRoundSchema,
  gameRoundNumberSchema,
  gameRoundEndSchema,
  gameEndSchema,
  gameStateSyncSchema,
} from './schemas';
import { verifyGameParticipant, canControlGameFlow } from './participantAccess';
import { enrichCoffeeSnapshotForLateJoiner } from '../../games/coffee-roulette/lateJoiner';
import { sanitizeTwoTruthsStateForPublic } from '../../games/two-truths/reducer';
import { handleCoffeeRematchOnLeave } from './coffeeActionHandler';
import { flushPendingSignalsForParticipant } from './reliableEmit';

export function registerSessionLifecycleHandlers(ctx: GameHandlerContext): void {
  const { socket, gamesNs, gamesService, user, perSocket, voiceCaches } = ctx;

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
      // Prevent joining a finished session
      if (session?.status === 'finished') {
        socket.emit('error', { message: 'This game session has ended', code: 'SESSION_FINISHED' });
        ack?.({ ok: false, error: 'This game session has ended', code: 'SESSION_FINISHED' });
        return;
      }

      let snapshot = snapshotRaw;

      // Backfill legacy sessions that do not yet have a snapshot
      if (!snapshot) {
        const typeRow = await queryOne<{ key: string }>(
          `SELECT gt.key FROM game_sessions gs JOIN game_types gt ON gt.id = gs.game_type_id WHERE gs.id = $1`,
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
        } else if (typeRow?.key === 'two-truths') {
          const state = {
            kind: 'two-truths',
            phase: 'waiting',
            round: 1,
            totalRounds: session.total_rounds || 4,
            presenterParticipantId: null,
            statements: null,
            votes: {},
            revealedLie: null,
            scores: {},
            submitSeconds: Number(session?.resolved_timing?.twoTruths?.submitSeconds || 30),
            voteSeconds: Number(session?.resolved_timing?.twoTruths?.voteSeconds || 20),
            gameStatus: 'waiting',
          };
          snapshot = await gamesService.saveSnapshot(data.sessionId, state);
        } else if (typeRow?.key === 'strategic-escape') {
          const state = {
            kind: 'strategic-escape',
            phase: 'setup',
            industryKey: null,
            crisisKey: null,
            difficultyKey: 'medium',
            industryLabel: 'General',
            crisisLabel: 'Scenario',
            difficultyLabel: 'medium',
            rolesAssigned: false,
            discussionDurationMinutes: Math.max(
              1,
              Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes ?? 45)
            ),
            gameStatus: 'waiting',
          };
          snapshot = await gamesService.saveSnapshot(data.sessionId, state);
        }
      }

      const roomId = `game:${data.sessionId}`;
      socket.join(roomId);
      perSocket.joinedSessions.add(data.sessionId);
      perSocket.joinedParticipantBySessionId.set(data.sessionId, participant.participantId);

      console.log('[Games] User joined game session', {
        socketId: socket.id,
        sessionId: data.sessionId,
        roomId,
        participantId: participant.participantId,
        userId: user.userId,
      });

      // Register socket mapping for targeted voice signaling
      const voiceKey = `${data.sessionId}:${participant.participantId}`;
      voiceCaches.voiceSocketByKey.set(voiceKey, socket.id);
      const existing = voiceCaches.voiceKeysBySocket.get(socket.id) ?? new Set<string>();
      existing.add(voiceKey);
      voiceCaches.voiceKeysBySocket.set(socket.id, existing);

      // Re-deliver pending voice call requests and exact peer signals to this socket
      for (const [, pending] of voiceCaches.pendingVoiceCallRequests) {
        if (
          pending.modal.sessionId === data.sessionId &&
          pending.modal.toParticipantId === participant.participantId &&
          Date.now() - pending.createdAt <= voiceCaches.COFFEE_VOICE_CALL_REQUEST_TTL_MS
        ) {
          socket.emit('coffee:voice_call_modal', pending.modal);
        }
      }

      flushPendingSignalsForParticipant({
        socket,
        voiceCaches,
        sessionId: data.sessionId,
        participantId: participant.participantId,
      });

      // Notify others
      socket.to(roomId).emit('game:player_joined', {
        userId: user.userId,
        participantId: participant.participantId,
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });

      // Late joiner enrichment for Coffee Roulette
      let enrichedSnapshot = snapshot?.state;
      if (enrichedSnapshot && (enrichedSnapshot as any).kind === 'coffee-roulette') {
        try {
          enrichedSnapshot = await enrichCoffeeSnapshotForLateJoiner(
            enrichedSnapshot,
            data.sessionId,
            participant.participantId,
            session.event_id,
          );
        } catch (err) {
          console.warn('[CoffeeRoulette] Failed to enrich snapshot for late joiner', {
            sessionId: data.sessionId,
            participantId: participant.participantId,
            error: err,
          });
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
    const participantId = perSocket.joinedParticipantBySessionId.get(data.sessionId);

    socket.leave(roomId);
    perSocket.joinedSessions.delete(data.sessionId);
    perSocket.joinedParticipantBySessionId.delete(data.sessionId);

    // Remove voice socket keys
    const keys = voiceCaches.voiceKeysBySocket.get(socket.id);
    if (keys) {
      for (const key of Array.from(keys)) {
        if (key.startsWith(`${data.sessionId}:`)) {
          voiceCaches.voiceSocketByKey.delete(key);
          keys.delete(key);
        }
      }
      if (keys.size === 0) voiceCaches.voiceKeysBySocket.delete(socket.id);
    }

    socket.to(roomId).emit('game:player_left', {
      userId: user.userId,
      sessionId: data.sessionId,
      timestamp: new Date().toISOString(),
    });

    // Coffee Roulette: re-run pairing when a paired participant leaves
    if (participantId) {
      handleCoffeeRematchOnLeave(ctx, data.sessionId, participantId);
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

      await transaction(async (client) => {
        const { rows: [round] } = await client.query(
          `UPDATE game_rounds SET status = 'finished', ended_at = NOW()
           WHERE id = $1 AND game_session_id = $2 AND status = 'active' RETURNING id`,
          [data.roundId, data.sessionId],
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
      // Idempotent: check if already finished
      const session = await queryOne(
        `SELECT status, end_idempotency_key FROM game_sessions WHERE id = $1`,
        [data.sessionId],
      );

      if (session?.status === 'finished') {
        console.info('[Games] Game already finished, returning cached results', { sessionId: data.sessionId });
        const results = await query(
          `SELECT participant_id, final_score FROM game_results WHERE game_session_id = $1`,
          [data.sessionId],
        );
        gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
          sessionId: data.sessionId,
          results: results.map((r: any) => ({ participantId: r.participant_id, score: r.final_score })),
          isRetry: true,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Coffee Roulette allows any participant to end; others require admin
      const gameKey = await getSessionGameKey(data.sessionId);
      if (gameKey !== 'coffee-roulette') {
        const ok = await canControlGameFlow(data.sessionId, user.userId, socket);
        if (!ok) {
          socket.emit('error', { message: 'Only event administrators can end games', code: 'FORBIDDEN' });
          return;
        }
      } else {
        const cachedEndParticipantId = perSocket.joinedParticipantBySessionId.get(data.sessionId);
        if (!cachedEndParticipantId) {
          const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
          if (!participant) {
            socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
            return;
          }
          perSocket.joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
        }
      }

      // Fetch latest snapshot for custom scores
      const latestSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
      const state = latestSnapshot?.state as any;
      let finalScores: Record<string, number> | undefined;
      if (state?.kind === 'two-truths' && state.scores) {
        finalScores = state.scores;
      }

      // Row-locked transaction for idempotent finish
      const { results, alreadyFinished } = await transaction(async () => {
        const sessionCheck = await queryOne(
          `SELECT status FROM game_sessions WHERE id = $1 FOR UPDATE`,
          [data.sessionId],
        );

        if (sessionCheck?.status === 'finished' || sessionCheck?.status === 'finishing') {
          return { results: [] as any[], alreadyFinished: true };
        }

        await query(
          `UPDATE game_sessions SET status = 'finishing', end_action_timestamp = NOW()
           WHERE id = $1 AND status IN ('active', 'paused')`,
          [data.sessionId],
        );

        const finishResult = await gamesService.finishSession(data.sessionId, finalScores);
        return { ...finishResult, alreadyFinished: false };
      });

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
      const cachedSyncParticipantId = perSocket.joinedParticipantBySessionId.get(data.sessionId);
      if (!cachedSyncParticipantId) {
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'Not a participant', code: 'FORBIDDEN' });
          return;
        }
        perSocket.joinedParticipantBySessionId.set(data.sessionId, participant.participantId);
      }

      const [sessionData, activeRound, snapshot] = await Promise.all([
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
          status: sessionData.status,
          currentRound: sessionData.current_round,
          startedAt: sessionData.started_at,
          endedAt: sessionData.ended_at,
          sessionDeadlineAt: (sessionData as any).session_deadline_at || null,
          resolvedTiming: (sessionData as any).resolved_timing || null,
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

  // ─── Disconnect cleanup ───
  socket.on('disconnect', async (_reason) => {
    // Cleanup voice signaling mappings
    const keys = voiceCaches.voiceKeysBySocket.get(socket.id);
    if (keys) {
      for (const key of keys) voiceCaches.voiceSocketByKey.delete(key);
      voiceCaches.voiceKeysBySocket.delete(socket.id);
    }

    for (const sessionId of perSocket.joinedSessions) {
      const participantId = perSocket.joinedParticipantBySessionId.get(sessionId);

      socket.to(`game:${sessionId}`).emit('game:player_left', {
        userId: user.userId,
        sessionId,
        timestamp: new Date().toISOString(),
      });

      // Coffee Roulette: re-run pairing on disconnect
      if (participantId) {
        handleCoffeeRematchOnLeave(ctx, sessionId, participantId);
      }
    }

    perSocket.joinedSessions.clear();
    perSocket.joinedParticipantBySessionId.clear();
  });
}
