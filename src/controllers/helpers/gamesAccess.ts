/**
 * Games controller auth/ownership helpers.
 */
import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthRequest } from '../../types';

export async function allowParticipantGameControlForEvent(eventId: string): Promise<boolean> {
  const row = await queryOne<{ allow: boolean }>(
    `SELECT COALESCE(allow_participant_game_control, true) as allow
     FROM event_settings
     WHERE event_id = $1`,
    [eventId]
  );
  return row ? !!row.allow : true;
}

/**
 * Verify the caller owns the given participant_id.
 * Supports both authenticated org members AND guest participants.
 */
export async function verifyParticipantOwnership(participantId: string, req: AuthRequest): Promise<void> {
  if (req.guest) {
    if (req.guest.participantId !== participantId) {
      throw new AppError('Guest token does not match the provided participant_id', 403, 'FORBIDDEN');
    }
    const guestRow = await queryOne(
      `SELECT id FROM participants WHERE id = $1 AND participant_type = 'guest' AND left_at IS NULL`,
      [participantId]
    );
    if (!guestRow) throw new AppError('Guest participant not found or has left', 403, 'FORBIDDEN');
    return;
  }

  if (req.user) {
    const memberRow = await queryOne(
      `SELECT p.id FROM participants p
       JOIN organization_members om ON om.id = p.organization_member_id
       WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
      [participantId, req.user.userId]
    );
    if (memberRow) return;
  }

  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}

/**
 * Resolve the caller's participant_id for a given event.
 * Supports both guests (from req.guest) and authenticated org members (via participants join).
 */
export async function resolveCallerParticipantId(eventId: string, req: AuthRequest): Promise<string | null> {
  if (req.guest) return req.guest.participantId;
  if (!req.user) return null;

  const row = await queryOne<{ id: string }>(
    `SELECT p.id
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [eventId, req.user.userId]
  );
  return row?.id || null;
}

export type EventMemberRole = { id: string; role_name: string };

async function getEventMemberRole(eventId: string, userId: string): Promise<EventMemberRole | null> {
  return queryOne<EventMemberRole>(
    `SELECT om.id, r.name as role_name FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN events e ON e.organization_id = om.organization_id
     WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [eventId, userId]
  );
}

/**
 * Assert caller can control game session (start round, finish session).
 * Requires authenticated user; when allowParticipantGameControl is false, requires admin/moderator.
 */
export async function assertCanControlGameSession(
  eventId: string,
  userId: string,
  allowParticipantGameControl: boolean
): Promise<void> {
  const member = await getEventMemberRole(eventId, userId);
  if (!member) throw new AppError("You are not a member of this event's organization", 403, 'NOT_A_MEMBER');
  if (!allowParticipantGameControl && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('Only admins and moderators can perform this action', 403, 'INSUFFICIENT_PERMISSIONS');
  }
}

/**
 * Assert caller can view session admin data (actions, snapshots).
 * Requires authenticated user + admin/moderator role.
 */
export async function assertCanViewSessionAdmin(eventId: string, userId: string): Promise<EventMemberRole> {
  const member = await getEventMemberRole(eventId, userId);
  if (!member) throw new AppError("You are not a member of this event's organization", 403, 'NOT_A_MEMBER');
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('Only admins and moderators can view this', 403, 'INSUFFICIENT_PERMISSIONS');
  }
  return member;
}

/**
 * Assert caller is event admin/moderator (for create session, debrief, etc.).
 */
export async function assertIsEventAdmin(eventId: string, userId: string): Promise<void> {
  const member = await getEventMemberRole(eventId, userId);
  if (!member) throw new AppError("You are not a member of this event's organization", 403, 'NOT_A_MEMBER');
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('Only admins and moderators can perform this action', 403, 'INSUFFICIENT_PERMISSIONS');
  }
}
