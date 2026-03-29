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
  const { socket, gamesNs, gamesService, voiceCaches, perSocket } = ctx;
  const user = ctx.user;

  const resolveParticipantForSession = async (sessionId: string) => {
    const cachedParticipantId = perSocket.joinedParticipantBySessionId.get(sessionId);
    if (cachedParticipantId) {
      return { participantId: cachedParticipantId };
    }

    const participant = await verifyGameParticipant(sessionId, user.userId, socket);
    if (participant) {
      perSocket.joinedParticipantBySessionId.set(sessionId, participant.participantId);
    }
    return participant;
  };

  const rejectVoice = (ack: ((payload: unknown) => void) | undefined, code: string, socketMessage?: string) => {
    if (socketMessage) {
      socket.emit('error', { message: socketMessage, code });
    }
    ack?.({ ok: false, error: code });
  };

  // ─── WebRTC: Voice Offer ───
  socket.on('coffee:voice_offer', async (data: unknown, ack) => {
    const validation = coffeeVoiceOfferSchema.safeParse(data);
    if (!validation.success) {
      rejectVoice(ack, 'VALIDATION', validation.error.issues[0]?.message || 'Invalid payload');
      return;
    }

    try {
      const caller = await resolveParticipantForSession(validation.data.sessionId);
      if (!caller) { rejectVoice(ack, 'FORBIDDEN', 'Not a participant'); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        rejectVoice(ack, 'VOICE_NOT_ACTIVE', 'Voice is only available during active chat'); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { rejectVoice(ack, 'PAIR_NOT_FOUND', 'Voice pair not found'); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) {
        console.warn('[CoffeeVoice] Caller not found in pair', {
          sessionId: validation.data.sessionId,
          pairId: validation.data.pairId,
          callerParticipantId: caller.participantId,
          pairPerson1: pair?.person1?.participantId,
          pairPerson2: pair?.person2?.participantId,
          userId: user.userId,
        });
        rejectVoice(ack, 'NOT_IN_PAIR', 'Caller is not in this voice pair');
        return;
      }
      if (info.callerSide !== 'person1') { rejectVoice(ack, 'VOICE_ROLE_MISMATCH', 'Only person1 can initiate voice'); return; }
      if (!info.partnerParticipantId) { rejectVoice(ack, 'PARTNER_NOT_FOUND', 'Voice partner not found'); return; }

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
      rejectVoice(ack, 'VOICE_OFFER_ERROR', 'Voice offer failed');
    }
  });

  // ─── WebRTC: Request Offer (answerer retrieves cached offer) ───
  socket.on('coffee:voice_request_offer', async (data: unknown, ack) => {
    const validation = coffeeVoiceRequestOfferSchema.safeParse(data);
    if (!validation.success) {
      rejectVoice(ack, 'VALIDATION', validation.error.issues[0]?.message || 'Invalid payload');
      return;
    }

    try {
      const caller = await resolveParticipantForSession(validation.data.sessionId);
      if (!caller) { rejectVoice(ack, 'FORBIDDEN', 'Not a participant'); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        rejectVoice(ack, 'VOICE_NOT_ACTIVE', 'Voice is only available during active chat'); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { rejectVoice(ack, 'PAIR_NOT_FOUND', 'Voice pair not found'); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { rejectVoice(ack, 'NOT_IN_PAIR', 'Caller is not in this voice pair'); return; }
      if (info.callerSide !== 'person2') { rejectVoice(ack, 'VOICE_ROLE_MISMATCH', 'Only person2 can request cached offer'); return; }

      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      const cached = voiceCaches.coffeeVoiceOfferCache.get(cacheKey);
      if (!cached) { rejectVoice(ack, 'OFFER_NOT_READY', 'Voice offer not ready yet'); return; }

      if (Date.now() - cached.createdAt > voiceCaches.COFFEE_VOICE_OFFER_TTL_MS) {
        voiceCaches.coffeeVoiceOfferCache.delete(cacheKey);
        rejectVoice(ack, 'OFFER_EXPIRED', 'Voice offer expired');
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
      rejectVoice(ack, 'VOICE_REQUEST_OFFER_ERROR', 'Voice offer request failed');
    }
  });

  // ─── WebRTC: Voice Answer ───
  socket.on('coffee:voice_answer', async (data: unknown, ack) => {
    const validation = coffeeVoiceAnswerSchema.safeParse(data);
    if (!validation.success) {
      rejectVoice(ack, 'VALIDATION', validation.error.issues[0]?.message || 'Invalid payload');
      return;
    }

    try {
      const caller = await resolveParticipantForSession(validation.data.sessionId);
      if (!caller) { rejectVoice(ack, 'FORBIDDEN', 'Not a participant'); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette' || state?.phase !== 'chatting') {
        rejectVoice(ack, 'VOICE_NOT_ACTIVE', 'Voice is only available during active chat'); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { rejectVoice(ack, 'PAIR_NOT_FOUND', 'Voice pair not found'); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { rejectVoice(ack, 'NOT_IN_PAIR', 'Caller is not in this voice pair'); return; }
      if (info.callerSide !== 'person2') { rejectVoice(ack, 'VOICE_ROLE_MISMATCH', 'Only person2 can answer voice'); return; }
      if (!info.partnerParticipantId) { rejectVoice(ack, 'PARTNER_NOT_FOUND', 'Voice partner not found'); return; }

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
      rejectVoice(ack, 'VOICE_ANSWER_ERROR', 'Voice answer failed');
    }
  });

  // ─── WebRTC: ICE Candidate ───
  socket.on('coffee:voice_ice_candidate', async (data: unknown, ack) => {
    const validation = coffeeVoiceIceCandidateSchema.safeParse(data);
    if (!validation.success) {
      rejectVoice(ack, 'VALIDATION', validation.error.issues[0]?.message || 'Invalid payload');
      return;
    }

    try {
      const caller = await resolveParticipantForSession(validation.data.sessionId);
      if (!caller) { rejectVoice(ack, 'FORBIDDEN', 'Not a participant'); return; }

      const { sessionId, pairId } = validation.data;
      const latest = await gamesService.getLatestSnapshot(sessionId);
      const state = latest?.state as any;
      const pair = (state?.pairs || []).find((p: any) => p.id === pairId);
      if (!pair) { rejectVoice(ack, 'PAIR_NOT_FOUND', 'Voice pair not found'); return; }
      const info = findCallerInPair(pair, caller.participantId);
      if (!info || !info.partnerParticipantId) { rejectVoice(ack, 'NOT_IN_PAIR', 'Caller is not in this voice pair'); return; }

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
      rejectVoice(ack, 'VOICE_ICE_ERROR', 'Voice ICE relay failed');
    }
  });

  // ─── WebRTC: Hangup ───
  socket.on('coffee:voice_hangup', async (data: unknown, ack) => {
    const validation = coffeeVoiceHangupSchema.safeParse(data);
    if (!validation.success) {
      rejectVoice(ack, 'VALIDATION', validation.error.issues[0]?.message || 'Invalid payload');
      return;
    }

    try {
      const caller = await resolveParticipantForSession(validation.data.sessionId);
      if (!caller) { rejectVoice(ack, 'FORBIDDEN', 'Not a participant'); return; }

      const latest = await gamesService.getLatestSnapshot(validation.data.sessionId);
      const state = latest?.state as any;
      if (state?.kind !== 'coffee-roulette') {
        rejectVoice(ack, 'VOICE_NOT_ACTIVE', 'Voice is not active'); return;
      }

      const pair = (state?.pairs || []).find((p: any) => p.id === validation.data.pairId);
      if (!pair) { rejectVoice(ack, 'PAIR_NOT_FOUND', 'Voice pair not found'); return; }

      const info = findCallerInPair(pair, caller.participantId);
      if (!info) { rejectVoice(ack, 'NOT_IN_PAIR', 'Caller is not in this voice pair'); return; }
      if (!info.partnerParticipantId) { rejectVoice(ack, 'PARTNER_NOT_FOUND', 'Voice partner not found'); return; }

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

      const cacheKey = `${validation.data.sessionId}:${validation.data.pairId}`;
      voiceCaches.coffeeVoiceOfferCache.delete(cacheKey);

      ack?.({ ok: true });
    } catch (err) {
      console.error('[voice_hangup] error:', err);
      rejectVoice(ack, 'VOICE_HANGUP_ERROR', 'Voice hangup failed');
    }
  });
}
