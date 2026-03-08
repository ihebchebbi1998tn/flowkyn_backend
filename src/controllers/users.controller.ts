import { Response, NextFunction } from 'express';
import { UsersService } from '../services/users.service';
import { FilesService } from '../services/files.service';
import { AuthRequest } from '../types';
import { saveFile, isAllowedImageType } from '../utils/upload';
import { AppError } from '../middleware/errorHandler';

const usersService = new UsersService();
const filesService = new FilesService();

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
      res.json(user);
    } catch (err) { next(err); }
  }

  async uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400);
      if (!isAllowedImageType(file.mimetype)) throw new AppError('Only image files are allowed', 400);

      // Save to flowkyn_uploads/avatars/
      const { url } = saveFile(file.buffer, file.originalname, 'avatars');

      // Store in files table
      await filesService.create(req.user!.userId, url, file.mimetype, file.size);

      // Update user avatar_url
      const user = await usersService.updateAvatar(req.user!.userId, url);

      res.json({ avatar_url: user?.avatar_url });
    } catch (err) { next(err); }
  }
}
