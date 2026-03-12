import { query, queryOne } from '../config/database';
import { UserRow } from '../types';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { sendEmail } from './email.service';
import { env } from '../config/env';
import { v4 as uuid } from 'uuid';

export class UsersService {
  async getProfile(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `SELECT id, email, name, avatar_url, language, status, onboarding_completed, created_at, updated_at FROM users WHERE id = $1`,
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
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `UPDATE users SET onboarding_completed = true, updated_at = NOW() WHERE id = $1
       RETURNING id, email, name, avatar_url, language, status, onboarding_completed, created_at, updated_at`,
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
    invites: Array<{ email: string }>,
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

    // Send invitations
    for (const invite of invites) {
      try {
        const email = invite.email.trim().toLowerCase();

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
          `INSERT INTO organization_invitations (id, organization_id, email, role_id, invited_by_member_id, token, status, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '7 days', NOW())`,
          [uuid(), orgId, email, memberRole.id, invitedByMember.id, hashedToken]
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