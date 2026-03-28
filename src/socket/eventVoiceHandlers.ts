/**
 * Event Voice Chat Handlers — WebRTC signaling for group voice chat
 * Enables peer-to-peer audio in event chat rooms using Socket.io for signaling
 * Patterns adapted from Coffee Roulette but for N-to-N full mesh topology
 */

import { Namespace } from 'socket.io';
import { z } from 'zod';
import { AuthenticatedSocket } from './types';
import { query, queryOne } from '../config/database';

/**
 * Verify a user is an active participant in an event
 * Returns participant ID, display name, and avatar URL
 */
async function verifyVoiceParticipant(
  eventId: string,
  userId: string,
  socket?: AuthenticatedSocket
): Promise<{ participantId: string; displayName: string; avatarUrl: string | null } | null> {
  // Guest participant
  if (socket?.isGuest && socket.guestPayload) {
    const guestRow = await queryOne<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      guest_name: string;
      guest_avatar: string | null;
    }>(
      `SELECT p.id, p.guest_name, p.guest_avatar, ep.display_name, ep.avatar_url
       FROM participants p
       LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
       WHERE p.event_id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [eventId, socket.guestPayload.participantId]
    );

    if (guestRow) {
      return {
        participantId: guestRow.id,
        displayName: guestRow.display_name || guestRow.guest_name || 'Guest',
        avatarUrl: guestRow.avatar_url || guestRow.guest_avatar || null,
      };
    }
    return null;
  }

  // Authenticated user participant
  const authRow = await queryOne<{
    participant_id: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `SELECT ep.participant_id, COALESCE(ep.display_name, u.full_name, u.email) as display_name, ep.avatar_url
     FROM participants p
     JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
     LEFT JOIN users u ON u.id = ep.user_id
     WHERE p.event_id = $1 AND ep.user_id = $2 AND p.left_at IS NULL`,
    [eventId, userId]
  );

  if (authRow) {
    return {
      participantId: authRow.participant_id,
      displayName: authRow.display_name,
      avatarUrl: authRow.avatar_url || null,
    };
  }

  return null;
}

// ─── Validation Schemas ───

const eventVoiceJoinSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  participantId: z.string().uuid('Invalid participant ID'),
});

const eventVoiceOfferSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  fromParticipantId: z.string().uuid('Invalid from participant ID'),
  toParticipantId: z.string().uuid('Invalid to participant ID'),
  sdp: z.string().min(1).max(200000, 'SDP too large'),
});

const eventVoiceAnswerSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  fromParticipantId: z.string().uuid('Invalid from participant ID'),
  toParticipantId: z.string().uuid('Invalid to participant ID'),
  sdp: z.string().min(1).max(200000, 'SDP too large'),
});

const eventVoiceIceCandidateSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  fromParticipantId: z.string().uuid('Invalid from participant ID'),
  toParticipantId: z.string().uuid('Invalid to participant ID'),
  candidate: z.object({
    candidate: z.string().max(20000),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
    usernameFragment: z.string().nullable().optional(),
  }),
});

const eventVoiceStatusSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  participantId: z.string().uuid('Invalid participant ID'),
  status: z.enum(['idle', 'active', 'muted']),
});

const eventVoiceLeaveSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  participantId: z.string().uuid('Invalid participant ID'),
});

// ─── Setup Function ───

export function setupEventVoiceHandlers(eventsNs: Namespace) {
  // Track voice participants per event: Map<eventId, Set<participantId>>
  const voiceParticipantsByEvent = new Map<string, Set<string>>();

  // Track sockets by participant voice key: Map<eventId:participantId, socketId>
  const voiceSocketsByParticipant = new Map<string, string>();

  // Track which voice keys belong to each socket for cleanup: Map<socketId, Set<voiceKey>>
  const voiceKeysBySocket = new Map<string, Set<string>>();

  eventsNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;
    const joinedVoiceRooms = new Set<string>();

    // ─── Join voice room ───
    socket.on('event:voice_join', async (data: unknown, ack) => {
      const validation = eventVoiceJoinSchema.safeParse(data);
      if (!validation.success) {
        ack?.({
          ok: false,
          error: validation.error.issues[0]?.message || 'Invalid data',
        });
        return;
      }

      try {
        const { eventId, participantId } = validation.data;

        // Verify participant
        const participant = await verifyVoiceParticipant(eventId, user.userId, socket);
        if (!participant || participant.participantId !== participantId) {
          console.warn('[EventVoice] voice_join: participant verification failed', {
            eventId: eventId.substring(0, 8) + '...',
            requestedParticipantId: participantId.substring(0, 8) + '...',
          });
          ack?.({ ok: false, error: 'Not authorized' });
          return;
        }

        // Register voice participant
        const roomId = `event:${eventId}:voice`;
        socket.join(roomId);
        joinedVoiceRooms.add(roomId);

        if (!voiceParticipantsByEvent.has(eventId)) {
          voiceParticipantsByEvent.set(eventId, new Set());
        }
        voiceParticipantsByEvent.get(eventId)!.add(participantId);

        const voiceKey = `${eventId}:${participantId}`;
        voiceSocketsByParticipant.set(voiceKey, socket.id);

        if (!voiceKeysBySocket.has(socket.id)) {
          voiceKeysBySocket.set(socket.id, new Set());
        }
        voiceKeysBySocket.get(socket.id)!.add(voiceKey);

        // Notify others about new voice participant
        socket.to(roomId).emit('event:voice_participant_joined', {
          eventId,
          participantId,
          displayName: participant.displayName,
          avatarUrl: participant.avatarUrl,
          timestamp: new Date().toISOString(),
        });

        // Send list of existing voice participants
        const existingParticipants = Array.from(voiceParticipantsByEvent.get(eventId) || []).filter(
          (pid) => pid !== participantId
        );

        console.log('[EventVoice] Participant joined voice room', {
          eventId: eventId.substring(0, 8) + '...',
          participantId: participantId.substring(0, 8) + '...',
          voiceCount: voiceParticipantsByEvent.get(eventId)?.size || 0,
        });

        ack?.({
          ok: true,
          data: {
            eventId,
            participantId,
            existingVoiceParticipants: existingParticipants,
          },
        });
      } catch (err: any) {
        console.error('[EventVoice] voice_join error:', err.message);
        ack?.({ ok: false, error: 'Internal server error' });
      }
    });

    // ─── Send WebRTC offer ───
    socket.on('event:voice_offer', async (data: unknown, ack) => {
      const validation = eventVoiceOfferSchema.safeParse(data);
      if (!validation.success) {
        ack?.({
          ok: false,
          error: validation.error.issues[0]?.message || 'Invalid payload',
        });
        return;
      }

      try {
        const { eventId, fromParticipantId, toParticipantId, sdp } = validation.data;

        // Verify sender is authorized
        const participant = await verifyVoiceParticipant(eventId, user.userId, socket);
        if (!participant || participant.participantId !== fromParticipantId) {
          ack?.({ ok: false, error: 'Not authorized' });
          return;
        }

        // Route offer to specific participant's socket
        const recipientSocketId = voiceSocketsByParticipant.get(`${eventId}:${toParticipantId}`);
        if (!recipientSocketId) {
          console.warn('[EventVoice] Recipient not in voice channel', {
            eventId: eventId.substring(0, 8) + '...',
            toParticipantId: toParticipantId.substring(0, 8) + '...',
          });
          ack?.({ ok: false, error: 'Recipient not in voice channel' });
          return;
        }

        // Emit to recipient
        eventsNs.to(recipientSocketId).emit('event:voice_offer', {
          eventId,
          fromParticipantId,
          sdp,
        });

        ack?.({ ok: true });
      } catch (err: any) {
        console.error('[EventVoice] voice_offer error:', err.message);
        ack?.({ ok: false, error: 'Internal server error' });
      }
    });

    // ─── Send WebRTC answer ───
    socket.on('event:voice_answer', async (data: unknown, ack) => {
      const validation = eventVoiceAnswerSchema.safeParse(data);
      if (!validation.success) {
        ack?.({
          ok: false,
          error: validation.error.issues[0]?.message || 'Invalid payload',
        });
        return;
      }

      try {
        const { eventId, fromParticipantId, toParticipantId, sdp } = validation.data;

        // Verify sender
        const participant = await verifyVoiceParticipant(eventId, user.userId, socket);
        if (!participant || participant.participantId !== fromParticipantId) {
          ack?.({ ok: false, error: 'Not authorized' });
          return;
        }

        // Route answer to specific participant
        const recipientSocketId = voiceSocketsByParticipant.get(`${eventId}:${toParticipantId}`);
        if (!recipientSocketId) {
          ack?.({ ok: false, error: 'Recipient not in voice channel' });
          return;
        }

        eventsNs.to(recipientSocketId).emit('event:voice_answer', {
          eventId,
          fromParticipantId,
          sdp,
        });

        ack?.({ ok: true });
      } catch (err: any) {
        console.error('[EventVoice] voice_answer error:', err.message);
        ack?.({ ok: false, error: 'Internal server error' });
      }
    });

    // ─── Send ICE candidate (best effort, no ack needed) ───
    socket.on('event:voice_ice_candidate', async (data: unknown) => {
      const validation = eventVoiceIceCandidateSchema.safeParse(data);
      if (!validation.success) {
        return;
      }

      try {
        const { eventId, fromParticipantId, toParticipantId, candidate } = validation.data;

        // Verify sender
        const participant = await verifyVoiceParticipant(eventId, user.userId, socket);
        if (!participant || participant.participantId !== fromParticipantId) {
          return;
        }

        // Route candidate to recipient
        const recipientSocketId = voiceSocketsByParticipant.get(`${eventId}:${toParticipantId}`);
        if (recipientSocketId) {
          eventsNs.to(recipientSocketId).emit('event:voice_ice_candidate', {
            eventId,
            fromParticipantId,
            candidate,
          });
        }
      } catch (err) {
        // Silently fail for ICE candidates
        console.debug('[EventVoice] ice_candidate error (ignored):', err);
      }
    });

    // ─── Broadcast voice status (talking/muted) ───
    socket.on('event:voice_status', async (data: unknown, ack) => {
      const validation = eventVoiceStatusSchema.safeParse(data);
      if (!validation.success) {
        ack?.({
          ok: false,
          error: validation.error.issues[0]?.message,
        });
        return;
      }

      try {
        const { eventId, participantId, status } = validation.data;

        // Verify sender
        const participant = await verifyVoiceParticipant(eventId, user.userId, socket);
        if (!participant || participant.participantId !== participantId) {
          ack?.({ ok: false, error: 'Not authorized' });
          return;
        }

        // Broadcast status to all in voice room
        const roomId = `event:${eventId}:voice`;
        eventsNs.to(roomId).emit('event:voice_status', {
          eventId,
          participantId,
          status,
          timestamp: new Date().toISOString(),
        });

        ack?.({ ok: true });
      } catch (err: any) {
        console.error('[EventVoice] voice_status error:', err.message);
        ack?.({ ok: false, error: 'Internal server error' });
      }
    });

    // ─── Leave voice room ───
    socket.on('event:voice_leave', async (data: unknown) => {
      const validation = eventVoiceLeaveSchema.safeParse(data);
      if (!validation.success) {
        return;
      }

      try {
        const { eventId, participantId } = validation.data;
        const roomId = `event:${eventId}:voice`;

        socket.leave(roomId);
        joinedVoiceRooms.delete(roomId);

        voiceParticipantsByEvent.get(eventId)?.delete(participantId);
        const voiceKey = `${eventId}:${participantId}`;
        voiceSocketsByParticipant.delete(voiceKey);

        // Clean up socket mapping
        const keys = voiceKeysBySocket.get(socket.id);
        if (keys) {
          keys.delete(voiceKey);
          if (keys.size === 0) {
            voiceKeysBySocket.delete(socket.id);
          }
        }

        // Notify others
        eventsNs.to(roomId).emit('event:voice_participant_left', {
          eventId,
          participantId,
          timestamp: new Date().toISOString(),
        });

        console.log('[EventVoice] Participant left voice room', {
          eventId: eventId.substring(0, 8) + '...',
          participantId: participantId.substring(0, 8) + '...',
          voiceCount: voiceParticipantsByEvent.get(eventId)?.size || 0,
        });
      } catch (err: any) {
        console.error('[EventVoice] voice_leave error:', err.message);
      }
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', () => {
      const keys = voiceKeysBySocket.get(socket.id);
      if (keys) {
        for (const key of Array.from(keys)) {
          const [eventId, participantId] = key.split(':');
          voiceParticipantsByEvent.get(eventId)?.delete(participantId);
          voiceSocketsByParticipant.delete(key);
          eventsNs.to(`event:${eventId}:voice`).emit('event:voice_participant_disconnected', {
            participantId,
            timestamp: new Date().toISOString(),
          });
        }
        voiceKeysBySocket.delete(socket.id);
      }

      for (const roomId of joinedVoiceRooms) {
        socket.to(roomId).emit('event:voice_disconnected', {
          timestamp: new Date().toISOString(),
        });
      }
      joinedVoiceRooms.clear();
    });
  });
}
