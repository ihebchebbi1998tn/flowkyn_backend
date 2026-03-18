import { query, queryOne } from '../config/database';
import { UserRow } from '../types';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { sendEmail } from './email.service';
import { env } from '../config/env';
import { v4 as uuid } from 'uuid';

export class UsersService {
  async getProfile(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'> & { organization_id?: string }>(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.language, u.status, u.onboarding_completed, u.created_at, u.updated_at,
              om.organization_id
       FROM users u
       LEFT JOIN organization_members om ON om.user_id = u.id AND om.status = 'active'
       WHERE u.id = $1
       ORDER BY om.created_at DESC LIMIT 1`,
      [userId]
    );
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    return user;
  }

  async updateProfile(userId: string, data: { name?: string; language?: string }) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.language) {
      fields.push(`language = $${idx++}`);
      values.push(data.language);
    }

    if (fields.length === 0) throw new AppError('No fields to update — provide name or language', 400, 'VALIDATION_FAILED');

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, email, name, avatar_url, language, status, onboarding_completed, created_at, updated_at`,
      values
    );

    return user;
  }

  async completeOnboarding(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'> & { organization_id?: string }>(
      `WITH updated AS (
         UPDATE users SET onboarding_completed = true, updated_at = NOW() WHERE id = $1
         RETURNING id, email, name, avatar_url, language, status, onboarding_completed, created_at, updated_at
       )
       SELECT u.*, om.organization_id
       FROM updated u
       LEFT JOIN organization_members om ON om.user_id = u.id AND om.status = 'active'
       ORDER BY om.created_at DESC LIMIT 1`,
      [userId]
    );
    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, email, name, avatar_url, language, status, onboarding_completed, created_at, updated_at`,
      [avatarUrl, userId]
    );
    return user;
  }

  /**
   * Send onboarding invitations to team members
   * Creates organization_invitations for each email
   */
  async sendOnboardingInvites(
    orgId: string,
    invitedByUserId: string,
    invites: Array<{ email: string; department?: string }>,
    lang?: string
  ) {
    // Get invited_by_member_id
    const invitedByMember = await queryOne<{ id: string, organization_id: string }>(
      `SELECT id, organization_id FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [orgId, invitedByUserId]
    );

    if (!invitedByMember) throw new AppError('Not a member of this organization', 403, 'FORBIDDEN');

    // Get organization details
    const org = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (!org) throw new AppError('Organization not found', 404, 'NOT_FOUND');

    // Get member role (required for organization_invitations)
    const memberRole = await queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'member'`
    );

    if (!memberRole) throw new AppError('System error: member role not found', 500, 'INTERNAL_ERROR');

    const results = {
      success: [] as string[],
      failed: [] as Array<{ email: string; reason: string }>,
    };

    // Cache department name -> id within this request (avoids repeated INSERT/SELECT per email)
    const departmentIdByName = new Map<string, string>();
    const getOrCreateDepartmentId = async (departmentName: string) => {
      const name = departmentName.trim();
      const cached = departmentIdByName.get(name);
      if (cached) return cached;

      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM departments WHERE organization_id = $1 AND name = $2`,
        [orgId, name]
      );
      if (existing) {
        departmentIdByName.set(name, existing.id);
        return existing.id;
      }

      const dept = await queryOne<{ id: string }>(
        `INSERT INTO departments (id, organization_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [uuid(), orgId, name]
      );
      departmentIdByName.set(name, dept.id);
      return dept.id;
    };

    // Send invitations
    for (const invite of invites) {
      try {
        const email = invite.email.trim().toLowerCase();
        const departmentName = invite.department?.trim() || 'General';
        const departmentId = await getOrCreateDepartmentId(departmentName);

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.failed.push({ email, reason: 'Invalid email format' });
          continue;
        }

        // Check if already a member
        const existing = await queryOne(
          `SELECT id FROM organization_members WHERE organization_id = $1 AND user_id IN (SELECT id FROM users WHERE email = $2)`,
          [orgId, email]
        );

        if (existing) {
          results.failed.push({ email, reason: 'Already a member of this organization' });
          continue;
        }

        // Check if already invited
        const alreadyInvited = await queryOne(
          `SELECT id FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'pending'`,
          [orgId, email]
        );

        if (alreadyInvited) {
          results.failed.push({ email, reason: 'Already invited' });
          continue;
        }

        // Create invitation
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

        await query(
          `INSERT INTO organization_invitations
            (id, organization_id, email, role_id, department_id, invited_by_member_id, token, status, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW() + INTERVAL '7 days', NOW())`,
          [uuid(), orgId, email, memberRole.id, departmentId, invitedByMember.id, hashedToken]
        );

        // Send invitation email
        await sendEmail({
          to: email,
          type: 'organization_invitation',
          data: {
            orgName: org.name,
            link: `${env.frontendUrl}/invite/${rawToken}?type=org`,
          },
          lang: lang || 'en',
        });

        results.success.push(email);
      } catch (error) {
        console.error(`Failed to invite ${invite.email}:`, error);
        results.failed.push({
          email: invite.email,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }
}