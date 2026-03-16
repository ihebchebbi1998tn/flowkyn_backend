import { Response, NextFunction } from 'express';
import { UsersService } from '../services/users.service';
import { FilesService } from '../services/files.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { saveFile, isAllowedImageType } from '../utils/upload';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { query, queryOne } from '../config/database';
import { comparePassword, hashPassword } from '../utils/hash';

const usersService = new UsersService();
const filesService = new FilesService();
const audit = new AuditLogsService();

export class UsersController {
  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await usersService.getProfile(req.user!.userId);
      res.json(user);
    } catch (err) { next(err); }
  }

  async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await usersService.updateProfile(req.user!.userId, req.body);
      await audit.create(null, req.user!.userId, 'USER_UPDATE_PROFILE', { changes: Object.keys(req.body) });
      res.json(user);
    } catch (err) { next(err); }
  }

  async uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400, 'FILE_MISSING');
      if (!isAllowedImageType(file.mimetype)) throw new AppError('Only image files (JPEG, PNG, GIF, WebP) are allowed', 400, 'FILE_TYPE_NOT_ALLOWED');

      const { url } = saveFile(file.buffer, file.originalname, 'avatars');
      await filesService.create(req.user!.userId, url, file.mimetype, file.originalname, file.size);
      const user = await usersService.updateAvatar(req.user!.userId, url);

      await audit.create(null, req.user!.userId, 'USER_UPLOAD_AVATAR', { mimetype: file.mimetype });
      res.json({ avatar_url: user?.avatar_url });
    } catch (err) { next(err); }
  }

  async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { current_password, new_password } = req.body;
      const userId = req.user!.userId;

      // Fetch current password hash
      const user = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

      // Verify current password
      const valid = await comparePassword(current_password, user.password_hash);
      if (!valid) throw new AppError('Current password is incorrect', 400, 'AUTH_INVALID_PASSWORD');

      // Hash and update
      const newHash = await hashPassword(new_password);
      await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);

      await audit.create(null, userId, 'USER_CHANGE_PASSWORD', { ip: req.ip });
      res.json({ message: 'Password updated successfully' });
    } catch (err) { next(err); }
  }

  async completeOnboarding(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await usersService.completeOnboarding(req.user!.userId);
      await audit.create(null, req.user!.userId, 'USER_COMPLETE_ONBOARDING', {});
      res.json(user);
    } catch (err) { next(err); }
  }

  /** POST /users/onboarding-invites — Send team invitations during onboarding */
  async sendOnboardingInvites(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { orgId, invites, lang } = req.body;
      const userId = req.user!.userId;

      if (!orgId || !Array.isArray(invites)) {
        throw new AppError('Invalid request: orgId and invites array required', 400, 'VALIDATION_FAILED');
      }

      // User must be the organization owner to invite during onboarding
      const member = await queryOne<{ member_id: string; role_name: string }>(
        `SELECT om.id as member_id, r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.organization_id = $1
           AND om.user_id = $2
           AND om.status = 'active'
         LIMIT 1`,
        [orgId, userId]
      );

      if (!member) throw new AppError('Not a member of this organization', 403, 'FORBIDDEN');
      if (member.role_name !== 'owner') {
        throw new AppError('Only the organization owner can invite during onboarding', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const result = await usersService.sendOnboardingInvites(orgId, userId, invites, lang);
      await audit.create(orgId, userId, 'ONBOARDING_SEND_INVITES', { count: invites.length });
      res.json(result);
    } catch (err) { next(err); }
  }

  async listUsers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit, offset } = parsePagination(req.query as any);
      const userId = req.user!.userId;

      // Get the user's organization — scope users to org members only
      const orgMember = await queryOne<{ organization_id: string }>(
        'SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1',
        [userId]
      );

      if (!orgMember) {
        // No org — return empty
        return res.json(buildPaginatedResponse([], 0, page, limit));
      }

      const orgId = orgMember.organization_id;
      const [data, countResult] = await Promise.all([
        query(
          `SELECT u.id, u.name, u.email, u.avatar_url, u.language, u.status, u.onboarding_completed,
                  u.created_at, u.updated_at, u.last_active_at, r.name as role, om.created_at as joined_at
           FROM users u
           JOIN organization_members om ON u.id = om.user_id
           JOIN roles r ON r.id = om.role_id
           WHERE om.organization_id = $1 AND u.status = 'active'
           ORDER BY u.name ASC LIMIT $2 OFFSET $3`,
          [orgId, limit, offset]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM organization_members om
           JOIN users u ON u.id = om.user_id
           WHERE om.organization_id = $1 AND u.status = 'active'`,
          [orgId]
        ),
      ]);
      res.json(buildPaginatedResponse(data, Number(countResult?.count || 0), page, limit));
    } catch (err) { next(err); }
  }

  async getUserById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await queryOne(
        'SELECT id, name, email, avatar_url, language, status, onboarding_completed, created_at FROM users WHERE id = $1',
        [req.params.id]
      );
      if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
      res.json(user);
    } catch (err) { next(err); }
  }

  async deleteAccount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;

      // Check if user is an org owner — prevent deletion if sole owner
      const ownedOrgs = await query(
        `SELECT om.organization_id,
                (SELECT COUNT(*) FROM organization_members om2
                 JOIN roles r2 ON r2.id = om2.role_id
                 WHERE om2.organization_id = om.organization_id AND r2.name = 'owner') as owner_count
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.user_id = $1 AND r.name = 'owner'`,
        [userId]
      );

      for (const org of ownedOrgs) {
        if (Number(org.owner_count) <= 1) {
          throw new AppError(
            'You are the sole owner of an organization. Transfer ownership before deleting your account.',
            400,
            'SOLE_OWNER'
          );
        }
      }

      // Invalidate all sessions
      await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);

      // Soft-delete: mark as inactive, anonymize PII
      await query(
        `UPDATE users SET status = 'deleted', email = CONCAT('deleted_', id, '@deleted.flowkyn.com'),
         name = 'Deleted User', avatar_url = NULL, updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      // Remove from org memberships
      await query('DELETE FROM organization_members WHERE user_id = $1', [userId]);

      await audit.create(null, userId, 'USER_DELETE_ACCOUNT', { ip: req.ip });
      res.json({ message: 'Account deleted successfully' });
    } catch (err) { next(err); }
  }

  /** PATCH /users/notification-preferences */
  async updateNotificationPreferences(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const prefs = req.body; // { email, event_reminders, activity_updates, weekly_digest, marketing }
      await query(
        `UPDATE users SET notification_preferences = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(prefs), userId]
      );
      res.json({ message: 'Notification preferences updated', preferences: prefs });
    } catch (err) { next(err); }
  }

  /** GET /users/notification-preferences */
  async getNotificationPreferences(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const user = await queryOne<{ notification_preferences: any }>(
        'SELECT notification_preferences FROM users WHERE id = $1',
        [userId]
      );
      const defaults = { email: true, event_reminders: true, activity_updates: true, weekly_digest: false, marketing: false };
      res.json(user?.notification_preferences || defaults);
    } catch (err) { next(err); }
  }
}
