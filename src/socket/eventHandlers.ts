/**
 * Event namespace handlers — chat, presence, typing, with DB persistence.
 * Includes avatar_url in chat messages for proper display.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { addPresence, removePresence, getPresence, checkRateLimit } from './index';
import { EventMessagesService } from '../services/events-messages.service';
import { queryOne } from '../config/database';
import { sanitizeText } from '../utils/sanitize';

const messagesService = new EventMessagesService();

/** Validate socket event data has required string fields */
function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

/** Verify a user is an active participant in an event and return their participant ID + display name + avatar */
async function verifyParticipant(eventId: string, userId: string, socket?: AuthenticatedSocket): Promise<{ participantId: string; memberId: string | null; displayName: string; avatarUrl: string | null } | null> {
  // If this is a guest socket, use the guest payload directly
  if (socket?.isGuest && socket.guestPayload) {
    const guestRow = await queryOne<{ id: string; guest_name: string; guest_avatar: string | null }>(
      `SELECT p.id, p.guest_name, p.guest_avatar FROM participants p
       WHERE p.event_id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [eventId, socket.guestPayload.participantId]
    );
    if (guestRow) {
      return { participantId: guestRow.id, memberId: null, displayName: guestRow.guest_name || 'Guest', avatarUrl: guestRow.guest_avatar || null };
    }
    return null;
  }

  // First try: match via organization_members (registered users)
  const memberRow = await queryOne<{ id: string; member_id: string | null; display_name: string; avatar_url: string | null }>(
    `SELECT p.id, p.organization_member_id as member_id,
            COALESCE(u.name, p.guest_name, 'Unknown') as display_name,
            u.avatar_url
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN users u ON u.id = om.user_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [eventId, userId]
  );
  if (memberRow) return { participantId: memberRow.id, memberId: memberRow.member_id, displayName: memberRow.display_name, avatarUrl: memberRow.avatar_url || null };

  return null;
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
        const participant = await verifyParticipant(data.eventId, user.userId, socket);
        // Also allow event creator (organizer) to join without being a participant
        let isOrganizer = false;
        if (!participant) {
          const eventRow = await queryOne<{ created_by_member_id: string }>(
            `SELECT e.created_by_member_id FROM events e
             JOIN organization_members om ON om.id = e.created_by_member_id
             WHERE e.id = $1 AND om.user_id = $2`,
            [data.eventId, user.userId]
          );
          if (eventRow) {
            isOrganizer = true;
          } else {
            socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
            ack?.({ ok: false, error: 'Not a participant' });
            return;
          }
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

        ack?.({ ok: true, data: { participantId: participant?.participantId || 'organizer', isOrganizer } });
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

      // Verify the user is a participant and use their ACTUAL participant ID
      const participant = await verifyParticipant(data.eventId, user.userId, socket);
      if (!participant) {
        // Allow organizer to chat too
        const eventRow = await queryOne<{ id: string }>(
          `SELECT e.id FROM events e
           JOIN organization_members om ON om.id = e.created_by_member_id
           WHERE e.id = $1 AND om.user_id = $2`,
          [data.eventId, user.userId]
        );
        if (!eventRow) {
          socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
          return;
        }
        // Organizer chatting — get their name
        const userRow = await queryOne<{ name: string; avatar_url: string | null }>(
          `SELECT name, avatar_url FROM users WHERE id = $1`, [user.userId]
        );
        const message = sanitizeText(data.message, 2000);
        if (message.length === 0) {
          socket.emit('error', { message: 'Message cannot be empty', code: 'VALIDATION' });
          return;
        }
        // Broadcast organizer message (not persisted to participant messages since they're not a participant)
        eventsNs.to(`event:${data.eventId}`).emit('chat:message', {
          id: `org-${Date.now()}`,
          participantId: 'organizer',
          senderName: userRow?.name || 'Organizer',
          senderAvatarUrl: userRow?.avatar_url || null,
          message,
          userId: user.userId,
          timestamp: new Date().toISOString(),
        });
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
        const saved = await messagesService.sendMessage(data.eventId, participant.participantId, message);

        // Broadcast to all in room (including sender for confirmation)
        // Include senderName and senderAvatarUrl for proper display
        eventsNs.to(`event:${data.eventId}`).emit('chat:message', {
          id: saved.id,
          participantId: participant.participantId,
          senderName: participant.displayName,
          senderAvatarUrl: participant.avatarUrl,
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
    // Cache user display name for typing events to avoid DB lookups
    let cachedDisplayName: string | null = null;

    socket.on('chat:typing', async (data: { eventId: string; isTyping: boolean }) => {
      if (!validateFields(data, ['eventId'])) return;
      if (!checkRateLimit(socket, 'chat:typing')) return;

      // Resolve display name once per connection
      if (!cachedDisplayName) {
        const participant = await verifyParticipant(data.eventId, user.userId, socket);
        cachedDisplayName = participant?.displayName || 'Someone';
      }

      socket.to(`event:${data.eventId}`).emit('chat:typing', {
        userId: user.userId,
        userName: cachedDisplayName,
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
