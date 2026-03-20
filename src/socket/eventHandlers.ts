/**
 * Event namespace handlers — chat, presence, typing, with DB persistence.
 * Includes avatar_url in chat messages for proper display.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { addPresence, removePresence, getPresence } from './index';
import { EventMessagesService } from '../services/events-messages.service';
import { query, queryOne } from '../config/database';
import { sanitizeText } from '../utils/sanitize';
import crypto from 'crypto';

const messagesService = new EventMessagesService();

/** Validate socket event data has required string fields */
function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

/** Verify a user is an active participant in an event and return their participant ID + display name + avatar */
async function verifyParticipant(eventId: string, userId: string, socket?: AuthenticatedSocket): Promise<{ participantId: string; memberId: string | null; displayName: string; avatarUrl: string | null } | null> {
  // If this is a guest socket, use the guest payload directly (prefer event profile if set)
  if (socket?.isGuest && socket.guestPayload) {
    let guestRow = await queryOne<{ id: string; display_name: string | null; avatar_url: string | null; guest_name: string; guest_avatar: string | null }>(
      `SELECT p.id, p.guest_name, p.guest_avatar, ep.display_name, ep.avatar_url
       FROM participants p
       LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
       WHERE p.event_id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [eventId, socket.guestPayload.participantId]
    );
    // Reload/self-heal fallback: if participantId from token no longer resolves,
    // recover by stable guest_identity_key for this event.
    if (!guestRow && socket.guestPayload.guestIdentityKey) {
      guestRow = await queryOne<{ id: string; display_name: string | null; avatar_url: string | null; guest_name: string; guest_avatar: string | null }>(
        `SELECT p.id, p.guest_name, p.guest_avatar, ep.display_name, ep.avatar_url
         FROM participants p
         LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
         WHERE p.event_id = $1
           AND p.participant_type = 'guest'
           AND p.guest_identity_key = $2
           AND p.left_at IS NULL
         ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
         LIMIT 1`,
        [eventId, socket.guestPayload.guestIdentityKey]
      );
      if (guestRow) {
        socket.guestPayload.participantId = guestRow.id;
      }
    }
    if (guestRow) {
      return {
        participantId: guestRow.id,
        memberId: null,
        displayName: guestRow.display_name || guestRow.guest_name || 'Guest',
        avatarUrl: guestRow.avatar_url || guestRow.guest_avatar || null
      };
    }
    return null;
  }

  // Recovery mode: token may be missing/expired, recover guest by stable identity key.
  if (socket?.isGuestByKey && typeof socket?.handshake?.auth?.guestIdentityKey === 'string') {
    const recoveryEventId = typeof socket.handshake.auth.eventId === 'string' ? socket.handshake.auth.eventId : '';
    const recoveryKey = socket.handshake.auth.guestIdentityKey;
    
    console.log('[Events] Attempting guest recovery via identity key', {
      requestedEventId: eventId,
      recoveryEventId,
      recoveryKeyPrefix: recoveryKey.substring(0, 8) + '...',
      eventIdMatch: recoveryEventId === eventId,
      socketId: socket.id,
    });
    
    if (!recoveryEventId || recoveryEventId !== eventId) {
      console.warn('[Events] Guest recovery blocked: eventId mismatch', {
        requested: eventId,
        recovery: recoveryEventId,
        socketId: socket.id,
      });
      return null;
    }

    const guestRow = await queryOne<{ id: string; display_name: string | null; avatar_url: string | null; guest_name: string; guest_avatar: string | null }>(
      `SELECT p.id, p.guest_name, p.guest_avatar, ep.display_name, ep.avatar_url
       FROM participants p
       LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
       WHERE p.event_id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [eventId, recoveryKey]
    );
    
    if (!guestRow) {
      console.warn('[Events] Guest recovery FAILED: no participant found with identity key', {
        eventId: eventId.substring(0, 8) + '...',
        recoveryKey: recoveryKey.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }

    console.log('[Events] Guest recovery SUCCESS', {
      eventId: eventId.substring(0, 8) + '...',
      participantId: guestRow.id.substring(0, 8) + '...',
      guestName: guestRow.guest_name,
      socketId: socket.id,
    });

    // Upgrade socket to normal guest mode for all future operations.
    socket.guestPayload = {
      participantId: guestRow.id,
      eventId,
      guestName: guestRow.guest_name || 'Guest',
      guestIdentityKey: recoveryKey,
      isGuest: true,
    };
    socket.isGuest = true;
    socket.isGuestByKey = false;
    socket.user = { userId: `guest:${guestRow.id}`, email: '' };

    console.log('[Events] Socket upgraded from recovery mode', {
      participantId: guestRow.id.substring(0, 8) + '...',
      socketIsGuest: socket.isGuest,
      socketIsGuestByKey: socket.isGuestByKey,
      socketId: socket.id,
    });

    return {
      participantId: guestRow.id,
      memberId: null,
      displayName: guestRow.display_name || guestRow.guest_name || 'Guest',
      avatarUrl: guestRow.avatar_url || guestRow.guest_avatar || null
    };
  }

  // First try: match via organization_members (registered users)
  // Prefer event_profiles display_name/avatar_url when set (per-event profile from lobby)
  const memberRow = await queryOne<{ id: string; member_id: string | null; display_name: string; avatar_url: string | null }>(
    `SELECT p.id, p.organization_member_id as member_id,
            COALESCE(ep.display_name, u.name, p.guest_name, 'Unknown') as display_name,
            COALESCE(ep.avatar_url, u.avatar_url) as avatar_url
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN users u ON u.id = om.user_id
     LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
     WHERE p.event_id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending') AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1`,
    [eventId, userId]
  );
  if (memberRow) return { participantId: memberRow.id, memberId: memberRow.member_id, displayName: memberRow.display_name, avatarUrl: memberRow.avatar_url || null };

  // FIX: If they are an active or pending member of the organization but bypassed the Lobby, 
  // auto-insert them into the participants table so they don't get silently blocked.
  const orgMember = await queryOne<{ id: string; name: string; avatar_url: string | null }>(
    `SELECT om.id, u.name, u.avatar_url
     FROM organization_members om
     JOIN events e ON e.organization_id = om.organization_id
     JOIN users u ON u.id = om.user_id
     WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [eventId, userId]
  );

  if (orgMember) {
    const participantId = crypto.randomUUID();
    const result = await query(
      `WITH existing AS (
         SELECT id FROM participants 
         WHERE event_id = $2 AND organization_member_id = $3 AND left_at IS NULL
       ),
       inserted AS (
         INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
         SELECT $1, $2, $3, 'member', NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1`,
      [participantId, eventId, orgMember.id]
    );
    
    return {
      participantId: result[0]?.id || participantId,
      memberId: orgMember.id,
      displayName: orgMember.name || 'Unknown',
      avatarUrl: orgMember.avatar_url || null
    };
  }

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
        ack?.({
          ok: false,
          error: 'Invalid event:join data',
          code: 'VALIDATION',
          details: { received: data },
        });
        return;
      }

      try {
        console.log(`[Events] User ${user.userId} attempting to join event ${data.eventId}`);
        // Verify user is a participant in this event (auto-inserts org members who bypassed the Lobby)
        const participant = await verifyParticipant(data.eventId, user.userId, socket);
        if (!participant) {
          console.warn(`[Events] User ${user.userId} tried to join event ${data.eventId} but is not a participant or org member`);
          socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
          ack?.({
            ok: false,
            error: 'Not a participant',
            code: 'FORBIDDEN',
            details: { isGuest: !!socket.isGuest, userId: user.userId, eventId: data.eventId },
          });
          return;
        }

        const roomId = `event:${data.eventId}`;
        socket.join(roomId);
        joinedRooms.add(data.eventId);
        await addPresence(data.eventId, user.userId);

        console.log(`[Events] User ${user.userId} joined event ${data.eventId} in room ${roomId}. Socket ID: ${socket.id}`);

        // Notify others
        socket.to(roomId).emit('event:user_joined', {
          userId: user.userId,
          timestamp: new Date().toISOString(),
        });

        // Send current presence to the joining user
        socket.emit('event:presence', {
          eventId: data.eventId,
          onlineUserIds: await getPresence(data.eventId),
        });

        ack?.({ ok: true, data: { participantId: participant.participantId } });
      } catch (err: any) {
        console.error(`[Events] event:join error for user ${user.userId} in event ${data.eventId}:`, err.message, err.stack);
        socket.emit('error', { message: 'Failed to join event room', code: 'INTERNAL' });
        ack?.({
          ok: false,
          error: 'Server error',
          code: 'INTERNAL',
          details: { message: err?.message || String(err) },
        });
      }
    });

    // ─── Leave event room ───
    socket.on('event:leave', (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;

      const roomId = `event:${data.eventId}`;
      socket.leave(roomId);
      joinedRooms.delete(data.eventId);
      void removePresence(data.eventId, user.userId);

      socket.to(roomId).emit('event:user_left', {
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });
    });
    // ─── Chat message (persisted to DB) ───
    socket.on('chat:message', async (data: { eventId: string; message: string }, ack) => {
      console.log(`[Events] chat:message received from user ${user.userId}:`, data);
      
      if (!validateFields(data, ['eventId', 'message'])) {
        console.warn(`[Events] Invalid chat:message data from user ${user.userId}`);
        socket.emit('error', { message: 'Invalid chat message data', code: 'VALIDATION' });
        ack?.({ ok: false, error: 'Invalid data' });
        return;
      }

      // Verify the user is a participant and use their ACTUAL participant ID
      // verifyParticipant auto-inserts org members (including organizers) who bypassed the Lobby
      const participant = await verifyParticipant(data.eventId, user.userId, socket);
      if (!participant) {
        console.warn(`[Events] User ${user.userId} is not a participant in event ${data.eventId}`);
        socket.emit('error', { message: 'You are not a participant in this event', code: 'FORBIDDEN' });
        ack?.({ ok: false, error: 'Not a participant' });
        return;
      }

      // Sanitize and truncate message
      const message = sanitizeText(data.message, 2000);
      if (message.length === 0) {
        socket.emit('error', { message: 'Message cannot be empty', code: 'VALIDATION' });
        ack?.({ ok: false, error: 'Empty message' });
        return;
      }

      try {
        // Persist to DB using server-resolved participant ID
        const saved = await messagesService.sendMessage(data.eventId, participant.participantId, message);

        const roomId = `event:${data.eventId}`;
        console.log(`[Events] Broadcasting message from ${participant.displayName} (${user.userId}) to room ${roomId}. Message ID: ${saved.id}`);

        // Broadcast to all in room (including sender for confirmation)
        // Include senderName and senderAvatarUrl for proper display
        const broadcastData = {
          id: saved.id,
          participantId: participant.participantId,
          senderName: participant.displayName,
          senderAvatarUrl: participant.avatarUrl,
          message,
          userId: user.userId,
          timestamp: saved.created_at,
        };
        
        eventsNs.to(roomId).emit('chat:message', broadcastData);

        console.log(`[Events] Message broadcast complete to room ${roomId}. Sent to all members.`);
        ack?.({ ok: true }); // Send acknowledgment after broadcasting
      } catch (err: any) {
        console.error(`[Events] chat:message error:`, err.message, err.stack);
        socket.emit('error', { message: 'Failed to send message', code: 'CHAT_ERROR' });
        ack?.({ ok: false, error: err.message });
      }
    });


    // ─── Typing indicator (not persisted) ───
    // Cache user display name for typing events to avoid DB lookups
    let cachedDisplayName: string | null = null;

    socket.on('chat:typing', async (data: { eventId: string; isTyping: boolean }) => {
      if (!validateFields(data, ['eventId'])) return;
      try {
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
      } catch (err: any) {
        console.error('[Events] chat:typing error:', err?.message || err);
        socket.emit('error', { message: 'Failed to process typing event', code: 'INTERNAL' });
      }
    });

    // ─── Lobby/game countdown (host-triggered, broadcast to room) ───
    socket.on('event:start_countdown', async (data: { eventId: string; durationSeconds?: number }, ack) => {
      if (!validateFields(data, ['eventId'])) {
        ack?.({ ok: false, error: 'Invalid data' });
        return;
      }
      const duration = typeof data.durationSeconds === 'number' && data.durationSeconds > 0
        ? Math.min(Math.max(data.durationSeconds, 3), 30)
        : 5;
      try {
        // Verify caller is an event admin/moderator/owner OR the event creator (host)
        const member = await queryOne<{ role_name: string; member_id: string; created_by_member_id: string }>(
          `SELECT r.name as role_name, om.id as member_id, e.created_by_member_id
           FROM organization_members om
           JOIN roles r ON r.id = om.role_id
           JOIN events e ON e.organization_id = om.organization_id
           WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
          [data.eventId, user.userId]
        );
        const isPrivileged =
          !!member &&
          (['owner', 'admin', 'moderator'].includes(member.role_name) || member.member_id === member.created_by_member_id);
        if (!isPrivileged) {
          ack?.({ ok: false, error: 'INSUFFICIENT_PERMISSIONS' });
          return;
        }

        const roomId = `event:${data.eventId}`;
        eventsNs.to(roomId).emit('event:countdown', {
          eventId: data.eventId,
          durationSeconds: duration,
          startedAt: new Date().toISOString(),
        });
        ack?.({ ok: true });
      } catch (err: any) {
        console.error('[Events] event:start_countdown error:', err?.message || err);
        ack?.({ ok: false, error: 'INTERNAL' });
      }
    });

    // ─── Request current presence ───
    socket.on('event:presence', async (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;
      try {
        const onlineUserIds = await getPresence(data.eventId);
        socket.emit('event:presence', {
          eventId: data.eventId,
          onlineUserIds,
        });
      } catch (err: any) {
        console.error('[Events] event:presence error:', err?.message || err);
        socket.emit('error', { message: 'Failed to load presence', code: 'INTERNAL' });
      }
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', (reason) => {
      console.log(`[Events] User ${user.userId} disconnected: ${reason}`);

      // Remove from all joined rooms' presence
      for (const eventId of joinedRooms) {
        void removePresence(eventId, user.userId);
        socket.to(`event:${eventId}`).emit('event:user_left', {
          userId: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
      joinedRooms.clear();
    });
  });
}
