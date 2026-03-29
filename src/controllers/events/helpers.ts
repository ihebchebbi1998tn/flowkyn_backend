/**
 * Events Controller — Shared auth helpers
 */
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { queryOne } from '../../config/database';
import { hasGuestIdentityKey } from '../../utils/dbSafeColumns';

export async function requireOrgMember(orgId: string, userId: string): Promise<{ id: string; role_name: string }> {
  const member = await queryOne<{ id: string; role_name: string }>(
    `SELECT om.id, r.name as role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [orgId, userId]
  );
  if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
  return member;
}

export function requireAdminRole(member: { role_name: string }, action: string) {
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError(`You need owner, admin, or moderator role to ${action}`, 403, 'INSUFFICIENT_PERMISSIONS');
  }
}

export function getEventAuthPayload(req: AuthRequest): { isGuest: boolean; userId?: string; participantId?: string; eventId?: string; guestIdentityKey?: string } | null {
  if (req.user) return { ...req.user, isGuest: false };
  if (req.guest) {
    return {
      isGuest: true,
      participantId: req.guest.participantId,
      eventId: req.guest.eventId,
      guestIdentityKey: req.guest.guestIdentityKey,
    };
  }
  return null;
}

export async function verifyParticipantOwnership(participantId: string, userPayload: any): Promise<void> {
  if (userPayload.isGuest) {
    if (userPayload.participantId !== participantId) {
      throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
    }
    return;
  }

  const memberRow = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [participantId, userPayload.userId]
  );
  if (memberRow) return;

  const orgMemberRow = await queryOne(
    `SELECT om.id FROM organization_members om WHERE om.user_id = $1`,
    [userPayload.userId]
  );

  if (orgMemberRow) {
    const participantOrgRow = await queryOne(
      `SELECT p.id FROM participants p
       JOIN events e ON e.id = p.event_id
       WHERE p.id = $1 AND e.organization_id = (
         SELECT organization_id FROM organization_members WHERE user_id = $2 LIMIT 1
       )`,
      [participantId, userPayload.userId]
    );
    if (participantOrgRow) return;
  }

  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}

export async function requireCurrentParticipantId(eventId: string, userPayload: any): Promise<string> {
  if (userPayload.isGuest) {
    if (userPayload.eventId !== eventId) {
      throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
    }
    const byId = await queryOne<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND participant_type = 'guest' AND left_at IS NULL`,
      [userPayload.participantId, eventId]
    );
    if (byId) return byId.id;

    if (typeof userPayload.guestIdentityKey === 'string' && userPayload.guestIdentityKey.trim() && (await hasGuestIdentityKey())) {
      const byIdentity = await queryOne<{ id: string }>(
        `SELECT id FROM participants
         WHERE event_id = $1 AND participant_type = 'guest' AND guest_identity_key = $2 AND left_at IS NULL
         ORDER BY joined_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC LIMIT 1`,
        [eventId, userPayload.guestIdentityKey]
      );
      if (byIdentity) return byIdentity.id;
    }
    throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
  }

  const row = await queryOne<{ id: string }>(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC LIMIT 1`,
    [eventId, userPayload.userId]
  );

  if (!row) throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
  return row.id;
}
