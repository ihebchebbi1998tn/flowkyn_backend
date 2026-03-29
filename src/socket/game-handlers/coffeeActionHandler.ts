/**
 * Coffee Roulette game action handler.
 * Handles payload validation, reducer execution, and session finishing.
 */
import type { GameHandlerContext } from './handlerContext';
import { toSnapshotCreatedAt } from './snapshotUtils';
import { queryOne } from '../../config/database';
import { coffeeNextPromptSchema, coffeeContinueSchema } from './schemas';
import { reduceCoffeeState } from '../../games/coffee-roulette/reducer';
import { emitToRoomAndActor } from './reliableEmit';

interface CoffeeActionArgs {
  ctx: GameHandlerContext;
  data: { sessionId: string; roundId?: string; actionType: string; payload: any };
  participant: { participantId: string };
  roundId: string | null;
  session: any;
  ack?: Function;
}

export async function handleCoffeeAction({
  ctx,
  data,
  participant,
  roundId,
  session,
  ack,
}: CoffeeActionArgs): Promise<void> {
  const { socket, gamesNs, gamesService, actionQueues, voiceCaches } = ctx;

  console.log('[CoffeeRoulette] Processing coffee action', {
    actionType: data.actionType,
    sessionId: data.sessionId,
    participantId: participant.participantId,
    timestamp: new Date().toISOString(),
  });

  // Validate BEFORE persisting to DB
  if (data.actionType === 'coffee:next_prompt') {
    const payloadValidation = coffeeNextPromptSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { message: 'Invalid prompt request: ' + payloadValidation.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: payloadValidation.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = payloadValidation.data;
  }

  if (data.actionType === 'coffee:continue') {
    const payloadValidation = coffeeContinueSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { message: 'Invalid continue request: ' + payloadValidation.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: payloadValidation.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = payloadValidation.data;
  }

  const normalizedAction =
    data.actionType === 'coffee:end_and_finish' ? 'coffee:end' : data.actionType;

  const prevQueue = actionQueues.coffeeActionQueue.get(data.sessionId) ?? Promise.resolve();
  const run = prevQueue.then(async () => {
    const latestSnapshot = await gamesService.getLatestSnapshot(data.sessionId);

    const next = await reduceCoffeeState({
      eventId: session.event_id,
      actionType: normalizedAction,
      payload: data.payload,
      prev: (latestSnapshot?.state as any) || null,
      session,
    });

    let savedSnapshot: any = null;
    try {
      savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
    } catch (snapErr: any) {
      console.error('[CoffeeRoulette] Snapshot save failed, broadcasting anyway', { error: snapErr?.message });
    }

    // Persist action to DB AFTER validation and reducer succeed
    const coffeeRoundId = roundId || (await gamesService.getActiveRound(data.sessionId))?.id;
    if (coffeeRoundId) {
      try {
        await gamesService.submitAction(data.sessionId, coffeeRoundId, participant.participantId, data.actionType, data.payload || {});
      } catch (submitErr: any) {
        console.error('[CoffeeRoulette] submitAction failed (non-fatal)', { error: submitErr?.message });
      }
    }

    const roomId = `game:${data.sessionId}`;

    const broadcastPayload = {
      sessionId: data.sessionId,
      gameData: next,
      snapshotRevisionId: savedSnapshot?.id || null,
      snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
      sequenceNumber: savedSnapshot?.action_sequence_number || 0,
      revisionNumber: savedSnapshot?.revision_number || 1,
    };
    emitToRoomAndActor(gamesNs, socket, roomId, 'game:data', broadcastPayload);

    // Ack with new state for immediate client feedback
    ack?.({ ok: true, data: next });

    // Evict cached WebRTC offers when session ends
    if (normalizedAction === 'coffee:end') {
      for (const cacheKey of Array.from(voiceCaches.coffeeVoiceOfferCache.keys())) {
        if (cacheKey.startsWith(`${data.sessionId}:`)) {
          voiceCaches.coffeeVoiceOfferCache.delete(cacheKey);
        }
      }
    }

    // If requested, also close the DB session and broadcast game:ended
    if (data.actionType === 'coffee:end_and_finish') {
      const existingEnd = await queryOne(
        `SELECT id FROM game_sessions WHERE id = $1 AND status = 'finished'`,
        [data.sessionId],
      );

      if (!existingEnd) {
        const { results } = await gamesService.finishSession(data.sessionId);
        emitToRoomAndActor(gamesNs, socket, `game:${data.sessionId}`, 'game:ended', {
          sessionId: data.sessionId,
          results,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  actionQueues.coffeeActionQueue.set(data.sessionId, run.catch(() => undefined));

  try {
    await run;
  } catch (err: any) {
    console.error('[CoffeeRoulette] Action failed:', {
      sessionId: data.sessionId,
      actionType: data.actionType,
      userId: ctx.user.userId,
      error: err instanceof Error ? err.message : String(err),
    });

    // Even on error, broadcast the latest known state so clients aren't stuck
    try {
      const fallbackSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
      if (fallbackSnapshot?.state) {
        const fallbackPayload = {
          sessionId: data.sessionId,
          gameData: fallbackSnapshot.state,
          snapshotRevisionId: fallbackSnapshot.id || null,
          snapshotCreatedAt: toSnapshotCreatedAt(fallbackSnapshot.created_at),
        };
        emitToRoomAndActor(gamesNs, socket, `game:${data.sessionId}`, 'game:data', fallbackPayload);
        ack?.({ ok: false, error: err?.message, code: 'ACTION_ERROR', data: fallbackSnapshot.state });
      } else {
        ack?.({ ok: false, error: err?.message, code: 'ACTION_ERROR' });
      }
    } catch (fallbackErr) {
      console.error('[CoffeeRoulette] Fallback state broadcast also failed', { error: (fallbackErr as Error)?.message });
      ack?.({ ok: false, error: err?.message, code: 'ACTION_ERROR' });
    }

    socket.emit('error', { message: err?.message || 'Coffee action failed', code: 'ACTION_ERROR' });
  }
}

/**
 * Re-run Coffee Roulette pairing when a paired participant leaves or disconnects.
 */
export async function handleCoffeeRematchOnLeave(
  ctx: GameHandlerContext,
  sessionId: string,
  participantId: string,
): Promise<void> {
  const { gamesService, gamesNs, actionQueues } = ctx;

  const prevQueue = actionQueues.coffeeActionQueue.get(sessionId) ?? Promise.resolve();
  const run = prevQueue.then(async () => {
    try {
      const [latestSnapshot, session] = await Promise.all([
        gamesService.getLatestSnapshot(sessionId),
        gamesService.getSession(sessionId),
      ]);
      const state = latestSnapshot?.state as any;
      if (state?.kind !== 'coffee-roulette') return;
      if (!['matching', 'chatting'].includes(state?.phase)) return;

      const inPairs = (state?.pairs || []).some(
        (p: any) => p?.person1?.participantId === participantId || p?.person2?.participantId === participantId,
      );
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
      console.error('[Games] coffee rematch on leave failed', {
        sessionId,
        participantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  actionQueues.coffeeActionQueue.set(sessionId, run.catch(() => undefined));
  void run;
}
