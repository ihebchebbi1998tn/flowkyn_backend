/**
 * Coffee Roulette WebRTC signaling handlers: offer, request_offer, answer, ice_candidate, hangup.
 */
import type { GameHandlerContext } from './handlerContext';
import { verifyGameParticipant } from './participantAccess';
import {
  coffeeVoiceOfferSchema,
  coffeeVoiceAnswerSchema,
  coffeeVoiceIceCandidateSchema,
  coffeeVoiceRequestOfferSchema,
  coffeeVoiceHangupSchema,
} from './schemas';
import { emitToParticipantOrQueue } from './reliableEmit';

/** Shared helper: validate caller is in the specified pair and return their side + partner info. */
function findCallerInPair(
  pair: any,
  callerParticipantId: string,
): { callerSide: 'person1' | 'person2'; partnerParticipantId: string | null } | null {
  if (pair.person1?.participantId === callerParticipantId) {
    return { callerSide: 'person1', partnerParticipantId: pair.person2?.participantId || null };
  }
  if (pair.person2?.participantId === callerParticipantId) {
    return { callerSide: 'person2', partnerParticipantId: pair.person1?.participantId || null };
  }
  return null;
}

export function registerCoffeeWebRTCHandlers(ctx: GameHandlerContext): void {
  const { socket, gamesNs, gamesService, voiceCaches } = ctx;
  const user = ctx.user;

  // ─── WebRTC: Voice Offer ───
  socket.on('coffee:voice_offer', async (data: unknown, ack) => {
    const validation = coffeeVoiceOfferSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) { ack?.({ ok: false, error: 'FORBIDDEN' }); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' }); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }
      if (info.callerSide !== 'person1') { ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' }); return; }
      if (!info.partnerParticipantId) { ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' }); return; }

      // Cache offer for late joiners
      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      voiceCaches.coffeeVoiceOfferCache.set(cacheKey, {
        sdp: validation.data.sdp,
        fromParticipantId: caller.participantId,
        createdAt: Date.now(),
      });

      const offerPayload = {
        sessionId: validation.data.sessionId,
        pairId: validation.data.pairId,
        fromParticipantId: caller.participantId,
        sdp: validation.data.sdp,
      };

      const delivery = emitToParticipantOrQueue({
        gamesNs,
        voiceCaches,
        sessionId: validation.data.sessionId,
        participantId: info.partnerParticipantId,
        event: 'coffee:voice_offer',
        payload: offerPayload,
      });

      if (!delivery.delivered) {
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_offer_awaiting', {
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          toParticipantId: info.partnerParticipantId,
        });
      }

      ack?.({ ok: true, waiting: !delivery.delivered });
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
      if (!caller) { ack?.({ ok: false, error: 'FORBIDDEN' }); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' }); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }
      if (info.callerSide !== 'person2') { ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' }); return; }

      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      const cached = voiceCaches.coffeeVoiceOfferCache.get(cacheKey);
      if (!cached) { ack?.({ ok: false, error: 'OFFER_NOT_READY' }); return; }

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
      if (!caller) { ack?.({ ok: false, error: 'FORBIDDEN' }); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' }); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }
      if (info.callerSide !== 'person2') { ack?.({ ok: false, error: 'VOICE_ROLE_MISMATCH' }); return; }
      if (!info.partnerParticipantId) { ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' }); return; }

      emitToParticipantOrQueue({
        gamesNs,
        voiceCaches,
        sessionId: validation.data.sessionId,
        participantId: info.partnerParticipantId,
        event: 'coffee:voice_answer',
        payload: {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          sdp: validation.data.sdp,
        },
      });

      ack?.({ ok: true });
    } catch (err) {
      console.error('[voice_answer] error:', err);
      ack?.({ ok: false, error: 'VOICE_ANSWER_ERROR' });
    }
  });

  // ─── WebRTC: ICE Candidate ───
  // Performance: ICE candidates fire in rapid bursts (5-20+ per call).
  // We skip the expensive snapshot lookup and only verify participant + relay to partner.
  socket.on('coffee:voice_ice_candidate', async (data: unknown, ack) => {
    const validation = coffeeVoiceIceCandidateSchema.safeParse(data);
    if (!validation.success) {
      ack?.({ ok: false, error: validation.error.issues[0]?.message || 'Invalid payload' });
      return;
    }

    try {
      const caller = await verifyGameParticipant(validation.data.sessionId, user.userId, socket);
      if (!caller) { ack?.({ ok: false, error: 'FORBIDDEN' }); return; }

      const { sessionId, pairId } = validation.data;

      const latest = await gamesService.getLatestSnapshot(sessionId);
      const state = latest?.state as any;
      const pair = (state?.pairs || []).find((p: any) => p.id === pairId);
      if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }
      const info = findCallerInPair(pair, caller.participantId);
      if (!info || !info.partnerParticipantId) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }

      emitToParticipantOrQueue({
        gamesNs,
        voiceCaches,
        sessionId,
        participantId: info.partnerParticipantId,
        event: 'coffee:voice_ice_candidate',
        payload: {
          sessionId,
          pairId,
          fromParticipantId: caller.participantId,
          candidate: validation.data.candidate,
        },
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
      if (!caller) { ack?.({ ok: false, error: 'FORBIDDEN' }); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette') {
        ack?.({ ok: false, error: 'VOICE_NOT_ACTIVE' }); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }
      if (!info.partnerParticipantId) { ack?.({ ok: false, error: 'PARTNER_NOT_FOUND' }); return; }

      emitToParticipantOrQueue({
        gamesNs,
        voiceCaches,
        sessionId: validation.data.sessionId,
        participantId: info.partnerParticipantId,
        event: 'coffee:voice_hangup',
        payload: {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
        },
      });

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
