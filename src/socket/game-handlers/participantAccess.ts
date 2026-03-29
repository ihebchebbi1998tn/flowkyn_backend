import crypto from 'crypto';
import { query, queryOne } from '../../config/database';
import { hasGuestIdentityKey } from '../../utils/dbSafeColumns';
import type { AuthenticatedSocket } from '../types';

/** Verify the user is a participant in the game session's event and return their participant ID */
export async function verifyGameParticipant(
  sessionId: string,
  userId: string,
  socket?: AuthenticatedSocket
): Promise<{ participantId: string } | null> {
  if (socket?.isGuest && socket.guestPayload) {
    let guestRow = await queryOne<{ id: string }>(
      `SELECT p.id FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [sessionId, socket.guestPayload.participantId]
    );

    if (guestRow) {
      return { participantId: guestRow.id };
    }

    console.warn('[Games] Direct participant verification FAILED: participant not found in session', {
      sessionId: sessionId.substring(0, 8) + '...',
      participantIdFromToken: socket.guestPayload.participantId?.substring(0, 8) + '...',
      socketId: socket.id,
    });

    if (!socket.guestPayload.guestIdentityKey || !(await hasGuestIdentityKey())) {
      console.warn('[Games] Recovery BLOCKED: no identity key or column missing', {
        sessionId: sessionId.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }

    guestRow = await queryOne<{ id: string }>(
      `SELECT p.id
       FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [sessionId, socket.guestPayload.guestIdentityKey]
    );

    if (guestRow) {
      socket.guestPayload.participantId = guestRow.id;
      return { participantId: guestRow.id };
    }

    console.error('[Games] Fallback recovery FAILED: no participant found with identity key', {
      sessionId: sessionId.substring(0, 8) + '...',
      identityKeyPrefix: socket.guestPayload.guestIdentityKey.substring(0, 8) + '...',
      socketId: socket.id,
    });
    return null;
  }

  if (socket?.isGuestByKey && typeof socket?.handshake?.auth?.guestIdentityKey === 'string') {
    const recoveryEventId = typeof socket.handshake.auth.eventId === 'string' ? socket.handshake.auth.eventId : '';
    const recoveryKey = socket.handshake.auth.guestIdentityKey;

    if (!recoveryEventId || !(await hasGuestIdentityKey())) {
      console.warn('[Games] Guest recovery blocked: missing eventId or column', { sessionId: sessionId.substring(0, 8) + '...' });
      return null;
    }

    const guestRow = await queryOne<{ id: string; event_id: string; guest_name: string | null }>(
      `SELECT p.id, p.event_id, p.guest_name
       FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1
         AND p.participant_type = 'guest'
         AND p.guest_identity_key = $2
         AND p.left_at IS NULL
       ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 1`,
      [sessionId, recoveryKey]
    );

    if (!guestRow) {
      console.warn('[Games] Guest recovery FAILED: no participant found', {
        sessionId: sessionId.substring(0, 8) + '...',
        recoveryKey: recoveryKey.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }

    if (guestRow.event_id !== recoveryEventId) {
      console.warn('[Games] Guest recovery FAILED: eventId mismatch', {
        recoveryEventId: recoveryEventId.substring(0, 8) + '...',
        foundEventId: guestRow.event_id.substring(0, 8) + '...',
        socketId: socket.id,
      });
      return null;
    }

    socket.guestPayload = {
      participantId: guestRow.id,
      eventId: guestRow.event_id,
      guestName: guestRow.guest_name || 'Guest',
      guestIdentityKey: recoveryKey,
      isGuest: true,
    };
    socket.isGuest = true;
    socket.isGuestByKey = false;
    socket.user = { userId: `guest:${guestRow.id}`, email: '' };

    return { participantId: guestRow.id };
  }

  const row = await queryOne<{ id: string }>(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN game_sessions gs ON gs.event_id = p.event_id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending') AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1`,
    [sessionId, userId]
  );
  if (row) return { participantId: row.id };

  const orgMember = await queryOne<{ id: string; event_id: string }>(
    `SELECT om.id, gs.event_id
     FROM organization_members om
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [sessionId, userId]
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
      [participantId, orgMember.event_id, orgMember.id]
    );

    return { participantId: result[0]?.id || participantId };
  }

  return null;
}

async function isEventAdmin(sessionId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ role_name: string; member_id: string; created_by_member_id: string }>(
    `SELECT r.name as role_name, om.id as member_id, e.created_by_member_id
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [sessionId, userId]
  );
  if (!row) return false;
  return ['owner', 'admin', 'moderator'].includes(row.role_name) || row.member_id === row.created_by_member_id;
}

async function allowParticipantGameControlForSession(_sessionId: string): Promise<boolean> {
  // Any participant can control game sessions — admins only create events
  return true;
}

export async function canControlGameFlow(
  sessionId: string,
  userId: string,
  socket: AuthenticatedSocket
): Promise<boolean> {
  if (!(await allowParticipantGameControlForSession(sessionId))) {
    return isEventAdmin(sessionId, userId);
  }
  const participant = await verifyGameParticipant(sessionId, userId, socket);
  return !!participant;
}
