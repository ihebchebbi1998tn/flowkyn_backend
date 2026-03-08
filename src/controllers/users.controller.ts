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

  async listUsers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit, offset } = parsePagination(req.query as any);
      const [data, countResult] = await Promise.all([
        query(
          `SELECT id, name, email, avatar_url, language, status, onboarding_completed, created_at FROM users WHERE status = 'active' ORDER BY name ASC LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE status = 'active'`),
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
}
