import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { queryOne } from '../config/database';
import { InstanceOrchestratorService } from '../ai-events/services/instanceOrchestrator.service';
import { AppError } from '../middleware/errorHandler';

const orchestrator = new InstanceOrchestratorService();

async function resolveParticipantIdForSocket(eventId: string, socket: AuthenticatedSocket): Promise<string | null> {
  // Guest recovery mode (token missing but identity key is present in handshake).
  if (socket.isGuestByKey && socket.handshake?.auth?.guestIdentityKey) {
    const recoveryEventId =
      typeof socket.handshake.auth.eventId === 'string' ? socket.handshake.auth.eventId : '';
    const recoveryKey = socket.handshake.auth.guestIdentityKey;

    if (recoveryEventId && recoveryEventId !== eventId) return null;

    const guestRow = await queryOne<{ id: string }>(
      `SELECT p.id
       FROM participants p
       WHERE p.event_id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [eventId, recoveryKey]
    );
    return guestRow?.id || null;
  }

  // Guests: token already includes participant identity (and eventId).
  if (socket.isGuest && socket.guestPayload) {
    if (socket.guestPayload.eventId !== eventId) return null;
    return socket.guestPayload.participantId;
  }

  const userId = socket.user?.userId;
  if (!userId) return null;

  const row = await queryOne<{ id: string }>(
    `SELECT p.id
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1
       AND om.user_id = $2
       AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1`,
    [eventId, userId]
  );

  return row?.id || null;
}

export function setupAiEventHandlers(aiNs: Namespace) {
  aiNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;

    socket.on('ai:join_instance', async (data: { instanceId: string }, ack) => {
      try {
        const instance = await queryOne<{ event_id: string | null }>(
          `SELECT event_id
           FROM ai_event_instances
           WHERE id = $1`,
          [data.instanceId]
        );
        if (!instance) throw new AppError('Instance not found', 404, 'NOT_FOUND');

        const actorParticipantId = instance.event_id
          ? await resolveParticipantIdForSocket(instance.event_id, socket)
          : null;

        if (instance.event_id && !actorParticipantId) {
          throw new AppError('Not a participant', 403, 'FORBIDDEN');
        }

        socket.join(`ai:${data.instanceId}`);

        const latest = await orchestrator.getLatestState(data.instanceId, actorParticipantId);

        socket.emit('ai:state', { instanceId: data.instanceId, ...latest });
        aiNs.to(`ai:${data.instanceId}`).emit('ai:state_public', { instanceId: data.instanceId, revision: latest.revision, state: latest.state });

        ack?.({ ok: true, data: latest });
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
        socket.emit('error', { message, code });
        ack?.({ ok: false, error: message, code });
      }
    });

    socket.on('ai:state_sync', async (data: { instanceId: string }, ack) => {
      try {
        const instance = await queryOne<{ event_id: string | null }>(
          `SELECT event_id
           FROM ai_event_instances
           WHERE id = $1`,
          [data.instanceId]
        );
        if (!instance) throw new AppError('Instance not found', 404, 'NOT_FOUND');

        const actorParticipantId = instance.event_id
          ? await resolveParticipantIdForSocket(instance.event_id, socket)
          : null;

        if (instance.event_id && !actorParticipantId) {
          throw new AppError('Not a participant', 403, 'FORBIDDEN');
        }

        const latest = await orchestrator.getLatestState(data.instanceId, actorParticipantId);
        aiNs.to(`ai:${data.instanceId}`).emit('ai:state_public', { instanceId: data.instanceId, revision: latest.revision, state: latest.state });
        socket.emit('ai:state_private', { instanceId: data.instanceId, revision: latest.revision, privateView: latest.privateView });

        ack?.({ ok: true, data: latest });
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
        socket.emit('error', { message, code });
        ack?.({ ok: false, error: message, code });
      }
    });

    socket.on(
      'ai:action',
      async (data: { instanceId: string; actionType: string; payload?: Record<string, unknown> }, ack) => {
        try {
          const instance = await queryOne<{ event_id: string | null }>(
            `SELECT event_id
             FROM ai_event_instances
             WHERE id = $1`,
            [data.instanceId]
          );
          if (!instance) throw new AppError('Instance not found', 404, 'NOT_FOUND');

          const actorParticipantId = instance.event_id
            ? await resolveParticipantIdForSocket(instance.event_id, socket)
            : null;

          if (instance.event_id && !actorParticipantId) {
            throw new AppError('Not a participant', 403, 'FORBIDDEN');
          }

          const result = await orchestrator.applyAction({
            instanceId: data.instanceId,
            actionType: data.actionType,
            payload: data.payload || {},
            participantId: actorParticipantId,
          });

          aiNs.to(`ai:${data.instanceId}`).emit('ai:state_public', {
            instanceId: data.instanceId,
            revision: result.revision,
            state: result.state,
          });
          socket.emit('ai:state_private', {
            instanceId: data.instanceId,
            revision: result.revision,
            privateView: result.privateView,
          });

          ack?.({ ok: true, data: result });
        } catch (err: any) {
          const message = err instanceof Error ? err.message : String(err);
          const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
          socket.emit('error', { message, code });
          ack?.({ ok: false, error: message, code });
        }
      }
    );
  });
}

