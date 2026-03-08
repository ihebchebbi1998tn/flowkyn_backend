/**
 * Event namespace handlers — chat, presence, typing, with DB persistence.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { addPresence, removePresence, getPresence, checkRateLimit } from './index';
import { EventsService } from '../services/events.service';
import { queryOne } from '../config/database';
import { sanitizeText } from '../utils/sanitize';

const eventsService = new EventsService();

/** Validate socket event data has required string fields */
function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

/** Verify a user is an active participant in an event and return their participant ID */
async function verifyParticipant(eventId: string, userId: string): Promise<{ participantId: string; memberId: string } | null> {
  const row = await queryOne<{ id: string; member_id: string }>(
    `SELECT p.id, p.organization_member_id as member_id
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [eventId, userId]
  );
  return row ? { participantId: row.id, memberId: row.member_id } : null;
}

export function setupEventHandlers(eventsNs: Namespace) {
  eventsNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;
    console.log(`[Events] User ${user.userId} connected`);

    // Track which event rooms this socket is in (for cleanup on disconnect)
    const joinedRooms = new Set<string>();

    // ─── Join event room (with verification) ───
    socket.on('event:join', async (data: { eventId: string }, ack) => {
      if (!validateFields(data, ['eventId'])) {
        socket.emit('error', { message: 'Invalid event:join data', code: 'VALIDATION' });
        return;
      }

      try {
        // Verify user is a participant in this event
        const participant = await verifyParticipant(data.eventId, user.userId);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
          ack?.({ ok: false, error: 'Not a participant' });
          return;
        }

        const roomId = `event:${data.eventId}`;
        socket.join(roomId);
        joinedRooms.add(data.eventId);
        addPresence(data.eventId, user.userId);

        // Notify others
        socket.to(roomId).emit('event:user_joined', {
          userId: user.userId,
          timestamp: new Date().toISOString(),
        });

        // Send current presence to the joining user
        socket.emit('event:presence', {
          eventId: data.eventId,
          onlineUserIds: getPresence(data.eventId),
        });

        ack?.({ ok: true, data: { participantId: participant.participantId } });
      } catch (err: any) {
        console.error(`[Events] event:join error:`, err.message);
        socket.emit('error', { message: 'Failed to join event room', code: 'INTERNAL' });
        ack?.({ ok: false, error: 'Server error' });
      }
    });

    // ─── Leave event room ───
    socket.on('event:leave', (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;

      const roomId = `event:${data.eventId}`;
      socket.leave(roomId);
      joinedRooms.delete(data.eventId);
      removePresence(data.eventId, user.userId);

      socket.to(roomId).emit('event:user_left', {
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── Chat message (persisted to DB) ───
    socket.on('chat:message', async (data: { eventId: string; message: string }) => {
      if (!validateFields(data, ['eventId', 'message'])) {
        socket.emit('error', { message: 'Invalid chat message data', code: 'VALIDATION' });
        return;
      }
      if (!checkRateLimit(socket, 'chat:message')) return;

      // BUG FIX: Verify the user is a participant and use their ACTUAL participant ID
      // Previously accepted participantId from client, allowing impersonation
      const participant = await verifyParticipant(data.eventId, user.userId);
      if (!participant) {
        socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
        return;
      }

      // Sanitize and truncate message
      const message = sanitizeText(data.message, 2000);
      if (message.length === 0) {
        socket.emit('error', { message: 'Message cannot be empty', code: 'VALIDATION' });
        return;
      }

      try {
        // Persist to DB using server-resolved participant ID
        const saved = await eventsService.sendMessage(data.eventId, participant.participantId, message);

        // Broadcast to all in room (including sender for confirmation)
        eventsNs.to(`event:${data.eventId}`).emit('chat:message', {
          id: saved.id,
          participantId: participant.participantId,
          message,
          userId: user.userId,
          timestamp: saved.created_at,
        });
      } catch (err: any) {
        console.error(`[Events] chat:message error:`, err.message);
        socket.emit('error', { message: 'Failed to send message', code: 'CHAT_ERROR' });
      }
    });

    // ─── Typing indicator (not persisted) ───
    socket.on('chat:typing', (data: { eventId: string; isTyping: boolean }) => {
      if (!validateFields(data, ['eventId'])) return;
      if (!checkRateLimit(socket, 'chat:typing')) return;

      // BUG FIX: Use userId instead of client-supplied participantId
      socket.to(`event:${data.eventId}`).emit('chat:typing', {
        userId: user.userId,
        isTyping: !!data.isTyping,
      });
    });

    // ─── Request current presence ───
    socket.on('event:presence', (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;
      socket.emit('event:presence', {
        eventId: data.eventId,
        onlineUserIds: getPresence(data.eventId),
      });
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', (reason) => {
      console.log(`[Events] User ${user.userId} disconnected: ${reason}`);

      // Remove from all joined rooms' presence
      for (const eventId of joinedRooms) {
        removePresence(eventId, user.userId);
        socket.to(`event:${eventId}`).emit('event:user_left', {
          userId: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
      joinedRooms.clear();
    });
  });
}
