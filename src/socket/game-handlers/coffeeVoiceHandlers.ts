/**
 * Coffee Roulette voice call modals and WebRTC signaling handlers.
 * Handles: voice_call_request, voice_call_response, voice_call_cancel,
 *          voice_offer, voice_request_offer, voice_answer, voice_ice_candidate, voice_hangup
 */
import { z } from 'zod';
import type { GameHandlerContext } from './handlerContext';
import { verifyGameParticipant } from './participantAccess';
import {
  coffeeVoiceOfferSchema,
  coffeeVoiceAnswerSchema,
  coffeeVoiceIceCandidateSchema,
  coffeeVoiceRequestOfferSchema,
  coffeeVoiceHangupSchema,
} from './schemas';

export function registerCoffeeVoiceHandlers(ctx: GameHandlerContext): void {
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
        console.log('[CoffeeVoice] Voice call accepted', {
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
        console.log('[CoffeeVoice] Voice call declined', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
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

  // ─── WebRTC: Voice Offer ───
  socket.on('coffee:voice_offer', async (data: unknown, ack) => {
    const validation = coffeeVoiceOfferSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) {
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
      if (callerSide !== 'person1') {
        ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
        return;
      }

      const partnerParticipantId = pair.person2?.participantId;
      if (!partnerParticipantId) {
        ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
        return;
      }

      // Cache offer for late joiners
      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      voiceCaches.coffeeVoiceOfferCache.set(cacheKey, {
        sdp: validation.data.sdp,
        fromParticipantId: caller.participantId,
        createdAt: Date.now(),
      });

      const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);

      if (partnerSocketId) {
        gamesNs.to(partnerSocketId).emit('coffee:voice_offer', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          sdp: validation.data.sdp,
        });
        ack?.({ ok: true });
      } else {
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

  // ─── WebRTC: Request Offer (answerer retrieves cached offer) ───
  socket.on('coffee:voice_request_offer', async (data: unknown, ack) => {
    const validation = coffeeVoiceRequestOfferSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) {
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
        ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
        return;
      }

      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      const cached = voiceCaches.coffeeVoiceOfferCache.get(cacheKey);
      if (!cached) {
        ack?.({ ok: false, error: 'OFFER_NOT_READY' });
        return;
      }

      if (Date.now() - cached.createdAt > voiceCaches.COFFEE_VOICE_OFFER_TTL_MS) {
        voiceCaches.coffeeVoiceOfferCache.delete(cacheKey);
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

  // ─── WebRTC: Voice Answer ───
  socket.on('coffee:voice_answer', async (data: unknown, ack) => {
    const validation = coffeeVoiceAnswerSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) {
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
        ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' });
        return;
      }

      const partnerParticipantId = pair.person1?.participantId;
      if (!partnerParticipantId) {
        ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
        return;
      }

      const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);
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

  // ─── WebRTC: ICE Candidate ───
  socket.on('coffee:voice_ice_candidate', async (data: unknown, ack) => {
    const validation = coffeeVoiceIceCandidateSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) {
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
        pair.person1?.participantId === caller.participantId ||
        pair.person2?.participantId === caller.participantId;
      if (!isInPair) {
        ack?.({ ok: false, error: 'NOT_IN_PAIR' });
        return;
      }

      const partnerParticipantId =
        pair.person1?.participantId === caller.participantId
          ? pair.person2?.participantId
          : pair.person1?.participantId;

      if (!partnerParticipantId) {
        ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
        return;
      }

      const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);
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

  // ─── WebRTC: Hangup ───
  socket.on('coffee:voice_hangup', async (data: unknown, ack) => {
    const validation = coffeeVoiceHangupSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) {
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
        pair.person1?.participantId === caller.participantId ||
        pair.person2?.participantId === caller.participantId;
      if (!isInPair) {
        ack?.({ ok: false, error: 'NOT_IN_PAIR' });
        return;
      }

      const partnerParticipantId =
        pair.person1?.participantId === caller.participantId
          ? pair.person2?.participantId
          : pair.person1?.participantId;
      if (!partnerParticipantId) {
        ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' });
        return;
      }

      const partnerKey = `${validation.data.sessionId}:${partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);
      if (partnerSocketId) {
        gamesNs.to(partnerSocketId).emit('coffee:voice_hangup', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
        });
      }

      // Clear cached offer
      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      voiceCaches.coffeeVoiceOfferCache.delete(cacheKey);

      ack?.({ ok: true });
    } catch (err) {
      console.error('[voice_hangup] error:', err);
      ack?.({ ok: false, error: 'VOICE_HANGUP_ERROR' });
    }
  });
}
