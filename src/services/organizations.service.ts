import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { generateSlug } from '../utils/slug';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { OrganizationRow, OrganizationMemberRow } from '../types';
import { saveFile, isAllowedImageType } from '../utils/upload';
import { env } from '../config/env';
import crypto from 'crypto';

export class OrganizationsService {
  async create(userId: string, data: {
    name: string; description?: string; industry?: string;
    company_size?: string; goals?: string[];
  }) {
    let slug = generateSlug(data.name);

    const existingSlug = await queryOne<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (existingSlug) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const orgId = uuid();
    const memberId = uuid();

    const ownerRole = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE name = 'owner'`);
    if (!ownerRole) throw new AppError('System error: owner role not found — run database migrations', 500, 'INTERNAL_ERROR');

    const org = await transaction(async (client) => {
      const { rows: [org] } = await client.query(
        `INSERT INTO organizations (id, name, slug, description, industry, company_size, goals, owner_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
        [orgId, data.name, slug, data.description || '', data.industry || null,
         data.company_size || null, data.goals || [], userId]
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
    if (!org) throw new AppError('Organization not found', 404, 'NOT_FOUND');
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
      data: { orgName: org.name, link: `${env.frontendUrl}/invite/${token}?type=org` },
      lang: emailLang,
    });

    return { message: 'Invitation sent' };
  }

  async acceptInvitation(userId: string, token: string) {
    const invitation = await queryOne<any>(
      `SELECT * FROM organization_invitations WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [token]
    );
    if (!invitation) throw new AppError('Invitation is invalid or has expired', 400, 'AUTH_VERIFICATION_EXPIRED');

    const existingMember = await queryOne(
      `SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [invitation.organization_id, userId]
    );
    if (existingMember) {
      await query(`UPDATE organization_invitations SET status = 'accepted' WHERE id = $1`, [invitation.id]);
      return { message: 'Already a member of this organization' };
    }

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

  async uploadLogo(orgId: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!isAllowedImageType(file.mimetype)) {
      throw new AppError('Only image files (JPEG, PNG, GIF, WebP) are allowed', 400, 'FILE_TYPE_NOT_ALLOWED');
    }
    const { url } = saveFile(file.buffer, file.originalname, 'org-logos');
    const org = await queryOne<OrganizationRow>(
      `UPDATE organizations SET logo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [url, orgId]
    );
    return org;
  }

  async updateOrg(orgId: string, data: { name?: string }) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.name) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (fields.length === 0) throw new AppError('No fields to update', 400, 'VALIDATION_FAILED');
    fields.push('updated_at = NOW()');
    values.push(orgId);
    return queryOne<OrganizationRow>(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
  }
}
