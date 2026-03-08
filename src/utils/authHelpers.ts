/**
 * @fileoverview Shared authorization helpers for controllers.
 * Prevents code duplication across auth, events, orgs controllers.
 */

import { queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

/**
 * Verify a user has an active membership in an org and return their role.
 * @throws {AppError} 403 if user is not an active member
 */
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

/** Require owner, admin, or moderator role */
export function requireAdminRole(member: { role_name: string }, action: string) {
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError(`You need owner, admin, or moderator role to ${action}`, 403, 'INSUFFICIENT_PERMISSIONS');
  }
}

/** Check if a member has admin-level role (owner or admin) */
export async function requireOrgAdmin(orgId: string, userId: string): Promise<{ id: string; role_name: string }> {
  const member = await queryOne<{ id: string; role_name: string }>(
    `SELECT om.id, r.name as role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [orgId, userId]
  );
  if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
  if (!['owner', 'admin'].includes(member.role_name)) {
    throw new AppError('Admin or owner role required for this action', 403, 'INSUFFICIENT_PERMISSIONS');
  }
  return member;
}

/**
 * Verify the authenticated user owns a given participant_id.
 * Supports both org-member participants and guest participants.
 */
export async function verifyParticipantOwnership(participantId: string, userId: string): Promise<void> {
  // Check org-member participant
  const memberRow = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [participantId, userId]
  );
  if (memberRow) return;

  // No match — user doesn't own this participant
  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}