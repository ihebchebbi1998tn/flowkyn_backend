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

interface StrategicActionArgs {
  ctx: GameHandlerContext;
  data: { sessionId: string; roundId?: string; actionType: string; payload: any };
  participant: { participantId: string };
  session: any;
}

export async function handleStrategicAction({
  ctx,
  data,
  participant,
  session,
}: StrategicActionArgs): Promise<void> {
  const { socket, gamesNs, gamesService, actionQueues } = ctx;

  if (!isStrategicAction(data.actionType)) {
    console.warn(`[Games] Ignoring unknown strategic action: ${data.actionType}`);
    socket.emit('error', { message: 'Unknown strategic action', code: 'VALIDATION' });
    return;
  }

  const ok = await canControlGameFlow(data.sessionId, ctx.user.userId, socket);
  if (!ok) {
    socket.emit('error', { message: 'Only event administrators can perform strategic actions', code: 'FORBIDDEN' });
    return;
  }

  // Payload validation
  if (data.actionType === 'strategic:configure') {
    const payloadValidation = strategicConfigureSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', {
        message: 'Invalid configuration: ' + payloadValidation.error.issues[0].message,
        code: 'VALIDATION',
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
        code: 'VALIDATION',
      });
      return;
    }
    data.payload = payloadValidation.data;
  }

  // Serialize per-session
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
    gamesNs.to(`game:${data.sessionId}`).emit('game:data', broadcastPayload);
    // Direct emit to sender as reliability fallback
    socket.emit('game:data', broadcastPayload);
  });

  actionQueues.strategicActionQueue.set(
    data.sessionId,
    strRun.catch(() => undefined),
  );

  await strRun;
}
