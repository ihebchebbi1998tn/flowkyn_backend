/**
 * Strategic Escape game action handler.
 * Handles validation, admin checks, reducer execution.
 */
import type { GameHandlerContext } from './handlerContext';
import { toSnapshotCreatedAt } from './snapshotUtils';
import { canControlGameFlow } from './participantAccess';
import { strategicConfigureSchema, strategicAssignRolesSchema } from './schemas';
import { isStrategicAction } from '../../games/actionPredicates';
import { reduceStrategicState } from '../../games/strategic-escape/reducer';
import { emitToRoomAndActor } from './reliableEmit';

interface StrategicActionArgs {
  ctx: GameHandlerContext;
  data: { sessionId: string; roundId?: string; actionType: string; payload: any };
  participant: { participantId: string };
  session: any;
  ack?: Function;
}

export async function handleStrategicAction({
  ctx,
  data,
  participant,
  session,
  ack,
}: StrategicActionArgs): Promise<void> {
  const { socket, gamesNs, gamesService, actionQueues } = ctx;

  if (!isStrategicAction(data.actionType)) {
    socket.emit('error', { message: 'Unknown strategic action', code: 'VALIDATION' });
    ack?.({ ok: false, error: 'Unknown strategic action', code: 'VALIDATION' });
    return;
  }

  const ok = await canControlGameFlow(data.sessionId, ctx.user.userId, socket);
  if (!ok) {
    socket.emit('error', { message: 'Only event administrators can perform strategic actions', code: 'FORBIDDEN' });
    ack?.({ ok: false, error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  if (data.actionType === 'strategic:configure') {
    const v = strategicConfigureSchema.safeParse(data.payload);
    if (!v.success) {
      socket.emit('error', { message: 'Invalid configuration: ' + v.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: v.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = v.data;
  }

  if (data.actionType === 'strategic:assign_roles') {
    const v = strategicAssignRolesSchema.safeParse(data.payload);
    if (!v.success) {
      socket.emit('error', { message: 'Invalid role assignment: ' + v.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: v.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = v.data;
  }

  const strPrev = actionQueues.strategicActionQueue.get(data.sessionId) ?? Promise.resolve();
  const strRun = strPrev.then(async () => {
    const freshLatest = await gamesService.getLatestSnapshot(data.sessionId);

    const next = await reduceStrategicState({
      eventId: session.event_id,
      actionType: data.actionType,
      payload: data.payload,
      prev: (freshLatest?.state as any) || null,
      session,
    });

    let savedSnapshot: any = null;
    try {
      savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
    } catch (snapErr: any) {
      console.error('[Strategic] Snapshot save failed, broadcasting anyway', { error: snapErr?.message });
    }

    const broadcastPayload = {
      sessionId: data.sessionId,
      gameData: next,
      snapshotRevisionId: savedSnapshot?.id || null,
      snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
    };
    emitToRoomAndActor(gamesNs, socket, `game:${data.sessionId}`, 'game:data', broadcastPayload);
    ack?.({ ok: true, data: next });
  });

  actionQueues.strategicActionQueue.set(data.sessionId, strRun.catch(() => undefined));

  try {
    await strRun;
  } catch (err: any) {
    console.error('[Strategic] Action failed:', {
      sessionId: data.sessionId,
      actionType: data.actionType,
      userId: ctx.user.userId,
      error: err instanceof Error ? err.message : String(err),
    });

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
      console.error('[Strategic] Fallback broadcast failed', { error: (fallbackErr as Error)?.message });
      ack?.({ ok: false, error: err?.message, code: 'ACTION_ERROR' });
    }

    socket.emit('error', { message: err?.message || 'Strategic action failed', code: 'ACTION_ERROR' });
  }
}
