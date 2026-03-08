import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { generateSlug } from '../utils/slug';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { OrganizationRow, OrganizationMemberRow } from '../types';
import crypto from 'crypto';

export class OrganizationsService {
  async create(userId: string, name: string) {
    let slug = generateSlug(name);

    const existingSlug = await queryOne<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (existingSlug) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const orgId = uuid();
    const memberId = uuid();

    const ownerRole = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE name = 'owner'`);
    if (!ownerRole) throw new AppError('Owner role not found. Seed roles first.', 500);

    const org = await transaction(async (client) => {
      const { rows: [org] } = await client.query(
        `INSERT INTO organizations (id, name, slug, owner_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
        [orgId, name, slug, userId]
      );

      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role_id, is_subscription_manager, status, joined_at, created_at)
         VALUES ($1, $2, $3, $4, true, 'active', NOW(), NOW())`,
        [memberId, orgId, userId, ownerRole.id]
      );

      await client.query(
        `INSERT INTO subscriptions (id, organization_id, plan_name, status, max_users, max_events, started_at)
         VALUES ($1, $2, 'free', 'active', 10, 5, NOW())`,
        [uuid(), orgId]
      );

      return org;
    });

    return org;
  }

  async getById(orgId: string) {
    const org = await queryOne<OrganizationRow>('SELECT * FROM organizations WHERE id = $1', [orgId]);
    if (!org) throw new AppError('Organization not found', 404);
    return org;
  }

  async listMembers(orgId: string) {
    return query(
      `SELECT om.*, u.name, u.email, u.avatar_url, r.name as role_name
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       JOIN roles r ON r.id = om.role_id
       WHERE om.organization_id = $1 AND om.status = 'active'
       ORDER BY om.joined_at ASC`,
      [orgId]
    );
  }

  async inviteMember(orgId: string, invitedByMemberId: string, email: string, roleId: string, lang?: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const org = await this.getById(orgId);

    // Try to get invitee's stored language preference
    const invitee = await queryOne<{ language: string }>('SELECT language FROM users WHERE email = $1', [email]);
    const emailLang = invitee?.language || lang || 'en';

    await query(
      `INSERT INTO organization_invitations (id, organization_id, email, role_id, invited_by_member_id, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [uuid(), orgId, email, roleId, invitedByMemberId, token]
    );

    await sendEmail({
      to: email,
      type: 'organization_invitation',
      data: { orgName: org.name, link: `https://app.flowkyn.com/invitations/accept?token=${token}` },
      lang: emailLang,
    });

    return { message: 'Invitation sent' };
  }

  async acceptInvitation(userId: string, token: string) {
    const invitation = await queryOne<any>(
      `SELECT * FROM organization_invitations WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [token]
    );
    if (!invitation) throw new AppError('Invalid or expired invitation', 400);

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role_id, invited_by_member_id, status, joined_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())`,
        [uuid(), invitation.organization_id, userId, invitation.role_id, invitation.invited_by_member_id]
      );
      await client.query(
        `UPDATE organization_invitations SET status = 'accepted' WHERE id = $1`,
        [invitation.id]
      );
    });

    return { message: 'Invitation accepted' };
  }

  async getMemberByUserId(orgId: string, userId: string) {
    return queryOne<OrganizationMemberRow>(
      `SELECT * FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [orgId, userId]
    );
  }
}
