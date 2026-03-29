import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function assertCanManageAiEvents(
  organizationId: string,
  userId: string
): Promise<void> {
  const member = await queryOne<{ role_name: string }>(
    `SELECT r.name AS role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
    [organizationId, userId]
  );
  if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('Insufficient permissions to manage AI events', 403, 'INSUFFICIENT_PERMISSIONS');
  }
}
