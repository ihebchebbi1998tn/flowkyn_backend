/**
 * Coffee Roulette voice call modal handlers: request, response, cancel.
 */
import { z } from 'zod';
import type { GameHandlerContext } from './handlerContext';
import { verifyGameParticipant } from './participantAccess';

export function registerCoffeeVoiceCallHandlers(ctx: GameHandlerContext): void {
  const { socket, gamesNs, gamesService, voiceCaches } = ctx;
  const user = ctx.user;

  // ─── Voice Call Request (Modal) ───
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
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);

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

      // Emit request modal to partner
      const receiverModal = {
        type: 'receiver' as const,
        sessionId: validation.data.sessionId,
        pairId: validation.data.pairId,
        initiatorParticipantId: initiator.participantId,
        initiatorName: initiatorSide === 'person1' ? pair.person1?.name : pair.person2?.name,
        initiatorAvatar: initiatorSide === 'person1' ? pair.person1?.avatar : pair.person2?.avatar,
        message: 'wants to start a voice call with you',
        toParticipantId: partnerParticipantId,
      };
      const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${partnerParticipantId}`;
      voiceCaches.pendingVoiceCallRequests.set(pendingKey, {
        modal: receiverModal,
        createdAt: Date.now(),
      });

      const roomId = `game:${validation.data.sessionId}`;
      gamesNs.to(roomId).emit('coffee:voice_call_modal', receiverModal);

      ack?.({ ok: true, partnerConnected: !!partnerSocketId });
    } catch (err) {
      console.error('[CoffeeVoice] voice_call_request error:', err);
      ack?.({ ok: false, error: 'VOICE_CALL_REQUEST_ERROR' });
    }
  });

  // ─── Voice Call Response (Accept/Decline) ───
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

      const pendingKey = `${validation.data.sessionId}:${validation.data.pairId}:${responder.participantId}`;
      voiceCaches.pendingVoiceCallRequests.delete(pendingKey);

      if (validation.data.accepted) {
        socket.emit('coffee:voice_call_accepted', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
        });
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_accepted', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          toParticipantId: initiatorParticipantId,
        });
      } else {
        socket.emit('coffee:voice_call_declined', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
        });
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_declined', {
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

  // ─── Voice Call Cancel ───
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
        voiceCaches.pendingVoiceCallRequests.delete(pendingKey);
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_call_cancelled', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          toParticipantId: partnerParticipantId,
        });
      }

      ack?.({ ok: true });
    } catch (err) {
      console.error('[CoffeeVoice] voice_call_cancel error:', err);
      ack?.({ ok: false, error: 'VOICE_CALL_CANCEL_ERROR' });
    }
  });
}
