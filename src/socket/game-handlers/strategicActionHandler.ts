/**
 * Strategic Escape game action handler.
 * Handles validation, admin checks, reducer execution.
 */
import type { GameHandlerContext } from './handlerContext';
import { toSnapshotCreatedAt } from './snapshotUtils';
import { canControlGameFlow } from './participantAccess';
import { strategicConfigureSchema, strategicAssignRolesSchema, strategicStartDiscussionSchema, strategicEndDiscussionSchema } from './schemas';
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

  if (data.actionType === 'strategic:start_discussion') {
    const v = strategicStartDiscussionSchema.safeParse(data.payload);
    if (!v.success) {
      socket.emit('error', { message: 'Invalid start discussion payload: ' + v.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: v.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = v.data;
  }

  if (data.actionType === 'strategic:end_discussion') {
    const v = strategicEndDiscussionSchema.safeParse(data.payload);
    if (!v.success) {
      socket.emit('error', { message: 'Invalid end discussion payload: ' + v.error.issues[0].message, code: 'VALIDATION' });
      ack?.({ ok: false, error: v.error.issues[0].message, code: 'VALIDATION' });
      return;
    }
    data.payload = v.data;
  }

  const strPrev = actionQueues.strategicActionQueue.get(data.sessionId) ?? Promise.resolve();
  const strRun = strPrev.then(async () => {
    const freshLatest = await gamesService.getLatestSnapshot(data.sessionId);
    const prevState = (freshLatest?.state as any) || null;

    console.log('[Strategic] Reducer input', {
      actionType: data.actionType,
      sessionId: data.sessionId,
      prevPhase: prevState?.phase || 'null',
      prevSnapshotId: freshLatest?.id || 'null',
      rolesAssigned: prevState?.rolesAssigned,
      payload: JSON.stringify(data.payload).slice(0, 200),
    });

    // Side-effect: actually assign roles in the DB before updating snapshot
    if (data.actionType === 'strategic:assign_roles') {
      const alreadyAssigned = prevState?.rolesAssigned && prevState?.phase === 'roles_assignment';
      if (!alreadyAssigned) {
        console.log('[Strategic] Calling gamesService.assignStrategicRoles for', data.sessionId);
        await gamesService.assignStrategicRoles(data.sessionId);
      }
    }

    const next = await reduceStrategicState({
      eventId: session.event_id,
      actionType: data.actionType,
      payload: data.payload,
      prev: prevState,
      session,
    });

    console.log('[Strategic] Reducer output', {
      actionType: data.actionType,
      sessionId: data.sessionId,
      nextPhase: (next as any)?.phase,
      phaseChanged: prevState?.phase !== (next as any)?.phase,
      rolesAssigned: (next as any)?.rolesAssigned,
    });

    let savedSnapshot: any = null;
    let snapshotSaveFailed = false;
    try {
      savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
    } catch (snapErr: any) {
      snapshotSaveFailed = true;
      console.error('[Strategic] Snapshot save failed — rolling back to last known state', {
        error: snapErr?.message,
        actionType: data.actionType,
        sessionId: data.sessionId,
      });

      // Broadcast the previous (known-good) state back to clients to prevent divergence
      const rollbackState = prevState || next;
      const rollbackPayload = {
        sessionId: data.sessionId,
        gameData: rollbackState,
        actionType: data.actionType,
        snapshotRevisionId: freshLatest?.id || null,
        snapshotCreatedAt: toSnapshotCreatedAt(freshLatest?.created_at),
        snapshotSaveError: true,
      };
      emitToRoomAndActor(gamesNs, socket, `game:${data.sessionId}`, 'game:data', rollbackPayload);
      socket.emit('error', {
        message: 'Game state could not be saved. Please retry your action.',
        code: 'SNAPSHOT_SAVE_FAILED',
      });
      ack?.({ ok: false, error: 'Snapshot save failed — state not persisted', code: 'SNAPSHOT_SAVE_FAILED', data: rollbackState });
      return;
    }

    const broadcastPayload = {
      sessionId: data.sessionId,
      gameData: next,
      actionType: data.actionType,
      snapshotRevisionId: savedSnapshot?.id || null,
      snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
    };

    console.log('[Strategic] Broadcasting game:data', {
      actionType: data.actionType,
      sessionId: data.sessionId,
      phase: (next as any)?.phase,
      snapshotRevisionId: savedSnapshot?.id || null,
    });

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
