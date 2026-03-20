import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import type { AuthRequest } from '../../types';

export async function assertCanStartSession(req: AuthRequest, eventId: string, allowParticipantGameControl: boolean): Promise<void> {
  if (req.user) {
    const member = await queryOne<{ id: string; role_name: string }>(
      `SELECT om.id, r.name as role_name FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       JOIN events e ON e.organization_id = om.organization_id
       WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
      [eventId, req.user.userId]
    );
    if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');

    if (!allowParticipantGameControl && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
      throw new AppError('Only admins and moderators can start game sessions', 403, 'INSUFFICIENT_PERMISSIONS');
    }
    return;
  }

  if (req.guest) {
    if (req.guest.eventId !== eventId) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const guestParticipant = await queryOne<{ id: string }>(
      `SELECT id
       FROM participants
       WHERE id = $1
         AND event_id = $2
         AND participant_type = 'guest'
         AND left_at IS NULL`,
      [req.guest.participantId, eventId]
    );
    if (!guestParticipant) {
      throw new AppError('You are not a participant in this event.', 403, 'NOT_PARTICIPANT');
    }

    if (!allowParticipantGameControl) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    return;
  }

  throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
}
