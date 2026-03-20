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
      `SELECT om.*, u.name, u.email, u.avatar_url, r.name as role_name,
              omd.department_id as department_id,
              COALESCE(d.name, 'General') as department,
              d.name as department_name
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       JOIN roles r ON r.id = om.role_id
       LEFT JOIN organization_member_departments omd ON omd.organization_member_id = om.id
       LEFT JOIN departments d ON d.id = omd.department_id
       WHERE om.organization_id = $1 AND om.status = 'active'
       ORDER BY om.joined_at ASC`,
      [orgId]
    );
  }

  async listInvitations(orgId: string) {
    return query(
      `SELECT oi.id, oi.email, oi.status, oi.invited_by_member_id, oi.created_at, oi.expires_at,
              oi.department_id as department_id,
              COALESCE(d.name, 'General') as department,
              d.name as department_name
       FROM organization_invitations oi
       LEFT JOIN departments d ON d.id = oi.department_id
       WHERE oi.organization_id = $1
       ORDER BY oi.created_at DESC`,
      [orgId]
    );
  }

  async listPeopleWithInvites(orgId: string) {
    const members = await this.listMembers(orgId);
    const invitations = await this.listInvitations(orgId);

    return {
      members,
      invitations,
    };
  }

  async inviteMember(orgId: string, invitedByMemberId: string, email: string, roleIdOrName: string, lang?: string) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const org = await this.getById(orgId);

    const invitee = await queryOne<{ language: string }>('SELECT language FROM users WHERE email = $1', [email]);
    const emailLang = invitee?.language || lang || 'en';

    let roleId = roleIdOrName;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleIdOrName);
    if (!isUuid) {
      const role = await queryOne<{ id: string }>('SELECT id FROM roles WHERE name = $1', [roleIdOrName.toLowerCase()]);
      if (!role) throw new AppError('Invalid role specified', 400, 'VALIDATION_FAILED');
      roleId = role.id;
    }

    await query(
      `INSERT INTO organization_invitations (id, organization_id, email, role_id, invited_by_member_id, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [uuid(), orgId, email, roleId, invitedByMemberId, hashedToken]
    );

    await sendEmail({
      to: email,
      type: 'organization_invitation',
      data: { orgName: org.name, link: `${env.frontendUrl}/invite/${rawToken}?type=org` },
      lang: emailLang,
    });

    return { message: 'Invitation sent' };
  }

  async acceptInvitation(userId: string, token: string) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const invitation = await queryOne<any>(
      `SELECT * FROM organization_invitations WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [hashedToken]
    );
    if (!invitation) throw new AppError('Invitation is invalid or has expired', 400, 'AUTH_VERIFICATION_EXPIRED');

    const ensureDepartmentId = async (orgId: string, name: string) => {
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM departments WHERE organization_id = $1 AND name = $2`,
        [orgId, name]
      );
      if (existing) return existing.id;

      const dept = await queryOne<{ id: string }>(
        `INSERT INTO departments (id, organization_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [uuid(), orgId, name]
      );
      if (!dept) throw new Error(`Failed to create department for organization ${orgId}`);
      return dept.id;
    };

    const departmentId = invitation.department_id
      ? invitation.department_id
      : await ensureDepartmentId(invitation.organization_id, 'General');

    const existingMember = await queryOne(
      `SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [invitation.organization_id, userId]
    );
    if (existingMember) {
      await query(`UPDATE organization_invitations SET status = 'accepted' WHERE id = $1`, [invitation.id]);

      // Ensure the member is mapped to the invitation's department
      await query(
        `INSERT INTO organization_member_departments (id, organization_member_id, department_id, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (organization_member_id) DO NOTHING`,
        [uuid(), existingMember.id, departmentId]
      );
      return { message: 'Already a member of this organization' };
    }

    await transaction(async (client) => {
      const memberId = uuid();
      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role_id, invited_by_member_id, status, joined_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())`,
        [memberId, invitation.organization_id, userId, invitation.role_id, invitation.invited_by_member_id]
      );

      await client.query(
        `INSERT INTO organization_member_departments (id, organization_member_id, department_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [uuid(), memberId, departmentId]
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

  async createDepartment(orgId: string, _createdByMemberId: string, name: string) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM departments WHERE organization_id = $1 AND name = $2`,
      [orgId, name]
    );
    if (existing) throw new AppError('Department already exists', 400, 'ALREADY_EXISTS');

    const deptId = uuid();
    const dept = await queryOne(
      `INSERT INTO departments (id, organization_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [deptId, orgId, name]
    );
    return dept;
  }

  async listDepartments(orgId: string) {
    return query(
      `SELECT id, organization_id, name, created_at, updated_at
       FROM departments
       WHERE organization_id = $1
       ORDER BY name ASC`,
      [orgId]
    );
  }

  async deleteDepartment(orgId: string, departmentId: string) {
    // Prevent deleting departments that are still in use
    const usage = await queryOne<{ member_count: string; invite_count: string }>(
      `
      SELECT
        (SELECT COUNT(*)::text
         FROM organization_member_departments omd
         JOIN organization_members om ON om.id = omd.organization_member_id
         WHERE omd.department_id = $1
           AND om.organization_id = $2
           AND om.status = 'active') AS member_count,
        (SELECT COUNT(*)::text
         FROM organization_invitations oi
         WHERE oi.department_id = $1
           AND oi.organization_id = $2
           AND oi.status = 'pending'
           AND oi.expires_at > NOW()) AS invite_count
      `,
      [departmentId, orgId]
    );

    const membersInDept = Number(usage?.member_count || 0);
    const invitesInDept = Number(usage?.invite_count || 0);

    if (membersInDept > 0 || invitesInDept > 0) {
      throw new AppError(
        'Department still has people assigned',
        400,
        'DEPARTMENT_IN_USE'
      );
    }

    const result = await queryOne(
      `DELETE FROM departments
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [departmentId, orgId]
    );
    if (!result) throw new AppError('Department not found', 404, 'NOT_FOUND');
    return { message: 'Department deleted' };
  }

  async updateDepartment(orgId: string, departmentId: string, name: string) {
    // Ensure no other department with same name exists in this org
    const existing = await queryOne<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE organization_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3`,
      [orgId, name, departmentId]
    );
    if (existing) {
      throw new AppError('Department already exists', 400, 'ALREADY_EXISTS');
    }

    const dept = await queryOne(
      `UPDATE departments
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING id, organization_id, name, created_at, updated_at`,
      [name, departmentId, orgId]
    );
    if (!dept) {
      throw new AppError('Department not found', 404, 'NOT_FOUND');
    }
    return dept;
  }

  /**
   * List distinct recipient emails for event invites targeted by departments.
   * Includes:
   * - Active org members mapped to those departments
   * - Pending org invitations assigned to those departments
   */
  async listEmailsByDepartments(orgId: string, departmentIds: string[]) {
    if (!departmentIds.length) return [];

    const rows = await query<{ email: string }>(
      `
      SELECT DISTINCT u.email
      FROM organization_member_departments omd
      JOIN organization_members om ON om.id = omd.organization_member_id
      JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1
        AND om.status = 'active'
        AND omd.department_id = ANY($2::uuid[])

      UNION

      SELECT DISTINCT oi.email
      FROM organization_invitations oi
      WHERE oi.organization_id = $1
        AND oi.status = 'pending'
        AND oi.expires_at > NOW()
        AND oi.department_id = ANY($2::uuid[])
      `,
      [orgId, departmentIds]
    );

    return rows.map((r) => r.email);
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

  async updateOrg(orgId: string, data: {
    name?: string;
    description?: string;
    industry?: string;
    company_size?: string;
    goals?: string[];
  }) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    
    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
    if (data.industry !== undefined) { fields.push(`industry = $${idx++}`); values.push(data.industry); }
    if (data.company_size !== undefined) { fields.push(`company_size = $${idx++}`); values.push(data.company_size); }
    if (data.goals !== undefined) { fields.push(`goals = $${idx++}`); values.push(data.goals); }
    
    if (fields.length === 0) throw new AppError('No fields to update', 400, 'VALIDATION_FAILED');
    fields.push('updated_at = NOW()');
    values.push(orgId);
    
    return queryOne<OrganizationRow>(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
  }
}
