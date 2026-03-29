/**
 * Two Truths game action handler.
 * Handles validation, presenter checks, reducer execution, and audit logging.
 */
import type { GameHandlerContext } from './handlerContext';
import { logAuditEvent } from './audit';
import { toSnapshotCreatedAt } from './snapshotUtils';
import { emitEventNotification } from '../emitter';
import {
  twoTruthsSubmitSchema,
  twoTruthsVoteSchema,
  twoTruthsRevealSchema,
} from './schemas';
import {
  sanitizeTwoTruthsStateForPublic,
  reduceTwoTruthsState,
  type TwoTruthsState,
} from '../../games/two-truths/reducer';

interface TwoTruthsActionArgs {
  ctx: GameHandlerContext;
  data: { sessionId: string; roundId?: string; actionType: string; payload: any };
  participant: { participantId: string };
  roundId: string;
  session: any;
}

export async function handleTwoTruthsAction({
  ctx,
  data,
  participant,
  roundId,
  session,
}: TwoTruthsActionArgs): Promise<void> {
  const { socket, gamesNs, gamesService, actionQueues } = ctx;

  // Reveal / next round: only the participant who submitted this round's statements
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
        message: 'Only the person who submitted this round\u2019s statements can do that.',
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

  // Payload validation
  if (data.actionType === 'two_truths:submit') {
    const payloadValidation = twoTruthsSubmitSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', {
        message: 'Invalid submission: ' + payloadValidation.error.issues[0].message,
        code: 'VALIDATION',
        issues: payloadValidation.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    data.payload = payloadValidation.data;
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
      socket.emit('error', { message: 'Invalid reveal', code: 'VALIDATION' });
      return;
    }
    data.payload = payloadValidation.data;
  }

  // Serialize per-session to prevent concurrent actions racing on stale snapshots.
  const ttPrev = actionQueues.twoTruthsActionQueue.get(data.sessionId) ?? Promise.resolve();
  const ttRun = ttPrev.then(async () => {
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

    let savedSnapshot: any = null;
    try {
      savedSnapshot = await gamesService.saveSnapshot(data.sessionId, next);
    } catch (snapErr: any) {
      console.error('[TwoTruths] Snapshot save failed, broadcasting anyway', { error: snapErr?.message });
    }

    // ALWAYS broadcast game:data — this is the primary state delivery mechanism.
    // Must never be skipped, even if snapshot save failed.
    const broadcastPayload = {
      sessionId: data.sessionId,
      gameData: publiclySafeState,
      snapshotRevisionId: savedSnapshot?.id || null,
      snapshotCreatedAt: toSnapshotCreatedAt(savedSnapshot?.created_at),
    };
    gamesNs.to(`game:${data.sessionId}`).emit('game:data', broadcastPayload);

    // Also emit directly to the acting socket as a reliability fallback.
    // Socket.IO room broadcasts can miss the sender in edge cases
    // (e.g., room join not yet flushed, adapter lag).
    socket.emit('game:data', broadcastPayload);

    // Redundant broadcast on the events namespace to reliably wake up
    // clients that haven't joined the game room yet.
    if (data.actionType === 'two_truths:start' && next.phase === 'submit') {
      emitEventNotification(session.event_id, 'game:session_created', {
        sessionId: data.sessionId,
      });
    }

    return savedSnapshot;
  });

  actionQueues.twoTruthsActionQueue.set(
    data.sessionId,
    ttRun.then(() => undefined).catch(() => undefined),
  );

  let savedSnapshot: Awaited<typeof ttRun>;
  try {
    savedSnapshot = await ttRun;
  } catch (ttErr: any) {
    console.error('[Games] two-truths snapshot/vote failed:', {
      sessionId: data.sessionId,
      actionType: data.actionType,
      userId: ctx.user.userId,
      error: ttErr instanceof Error ? ttErr.message : String(ttErr),
    });

    // Even on error, broadcast the latest known state so clients aren't stuck
    try {
      const fallbackSnapshot = await gamesService.getLatestSnapshot(data.sessionId);
      if (fallbackSnapshot?.state) {
        const fallbackState = sanitizeTwoTruthsStateForPublic(fallbackSnapshot.state);
        const fallbackPayload = {
          sessionId: data.sessionId,
          gameData: fallbackState,
          snapshotRevisionId: fallbackSnapshot.id || null,
          snapshotCreatedAt: toSnapshotCreatedAt(fallbackSnapshot.created_at),
        };
        gamesNs.to(`game:${data.sessionId}`).emit('game:data', fallbackPayload);
        socket.emit('game:data', fallbackPayload);
      }
    } catch (fallbackErr) {
      console.error('[TwoTruths] Fallback state broadcast also failed', { error: (fallbackErr as Error)?.message });
    }

    socket.emit('error', { message: ttErr?.message || 'Game action failed', code: 'ACTION_ERROR' });
    return;
  }

  let action: { created_at: Date } | null = null;
  try {
    action = await gamesService.submitAction(
      data.sessionId,
      roundId,
      participant.participantId,
      data.actionType,
      data.payload || {},
    );
  } catch (submitErr: any) {
    console.error('[Games] two-truths submitAction after snapshot (non-fatal):', {
      sessionId: data.sessionId,
      actionType: data.actionType,
      userId: ctx.user.userId,
      error: submitErr instanceof Error ? submitErr.message : String(submitErr),
    });
  }

  gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
    userId: ctx.user.userId,
    participantId: participant.participantId,
    actionType: data.actionType,
    payload: data.payload,
    timestamp: action?.created_at || new Date().toISOString(),
  });

  // Log vote actions to audit trail for dispute resolution
  if (data.actionType === 'two_truths:vote' && savedSnapshot) {
    const voteChoice = data.payload?.statementId;
    logAuditEvent({
      eventId: session.event_id,
      gameSessionId: data.sessionId,
      participantId: participant.participantId,
      userId: ctx.user.userId,
      action: 'vote_cast',
      details: {
        game: 'two-truths',
        statementId: voteChoice,
        round: (savedSnapshot?.state as any)?.round,
        phase: (savedSnapshot?.state as any)?.phase,
        timestamp: new Date().toISOString(),
      },
      ipAddress: ctx.socket.handshake.address,
      status: 'success',
    });
  }
}
