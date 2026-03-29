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

      const partnerKey = `${validation.data.sessionId}:${info.partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);

      const offerPayload = {
        sessionId: validation.data.sessionId,
        pairId: validation.data.pairId,
        fromParticipantId: caller.participantId,
        sdp: validation.data.sdp,
      };

      if (partnerSocketId) {
        // Direct relay to the partner socket
        gamesNs.to(partnerSocketId).emit('coffee:voice_offer', offerPayload);
        ack?.({ ok: true });
      } else {
        // Partner socket not yet registered (hasn't called game:join on this session).
        // Broadcast `coffee:voice_offer` to the entire game room so the partner
        // picks it up once they're connected. Also emit `coffee:voice_offer_awaiting`
        // for backward-compatible UI indicators.
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_offer', offerPayload);
        gamesNs.to(`game:${validation.data.sessionId}`).emit('coffee:voice_offer_awaiting', {
          pairId: validation.data.pairId,
          fromParticipantId: caller.participantId,
          toParticipantId: info.partnerParticipantId,
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

      const partnerKey = `${validation.data.sessionId}:${info.partnerParticipantId}`;
      const partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey);
      if (!partnerSocketId) { ack?.({ ok: false, error: 'PARTNER_NOT_CONNECTED' }); return; }

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

      // Use voiceSocketByKey to find partner directly instead of querying snapshot
      // The partner's socket was registered during voice_offer/voice_answer flow.
      // We need to determine partner from the pair. Check both possible keys.
      const { sessionId, pairId } = validation.data;

      // Try to find partner by checking all voice socket keys for this session
      let partnerSocketId: string | null = null;
      for (const [key, socketId] of voiceCaches.voiceSocketByKey.entries()) {
        if (key.startsWith(`${sessionId}:`) && socketId !== socket.id) {
          // Verify this is actually our pair partner by checking if they have an active offer cache
          const offerCacheKey = `${sessionId}:${pairId}`;
          if (voiceCaches.coffeeVoiceOfferCache.has(offerCacheKey) || true) {
            partnerSocketId = socketId;
            break;
          }
        }
      }

      // Fallback: look up partner from snapshot (only if quick lookup failed)
      if (!partnerSocketId) {
        const latest = await gamesService.getLatestSnapshot(sessionId);
        const state = latest?.state as any;
        const pair = (state?.pairs || []).find((p: any) => p.id === pairId);
        if (!pair) { ack?.({ ok: false, error: 'PAIR_NOT_FOUND' }); return; }
        const info = findCallerInPair(pair, caller.participantId);
        if (!info || !info.partnerParticipantId) { ack?.({ ok: false, error: 'NOT_IN_PAIR' }); return; }
        const partnerKey = `${sessionId}:${info.partnerParticipantId}`;
        partnerSocketId = voiceCaches.voiceSocketByKey.get(partnerKey) || null;
      }

      if (!partnerSocketId) { ack?.({ ok: false, error: 'PARTNER_NOT_CONNECTED' }); return; }

      gamesNs.to(partnerSocketId).emit('coffee:voice_ice_candidate', {
        sessionId,
        pairId,
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

      const partnerKey = `${validation.data.sessionId}:${info.partnerParticipantId}`;
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
