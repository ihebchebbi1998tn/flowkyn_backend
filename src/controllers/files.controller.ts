import { Response, NextFunction } from 'express';
import { FilesService } from '../services/files.service';
import { AuthRequest } from '../types';
import { saveFile, isAllowedFileType } from '../utils/upload';
import { AppError } from '../middleware/errorHandler';

const filesService = new FilesService();

export class FilesController {
  async upload(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400);
      if (!isAllowedFileType(file.mimetype)) throw new AppError('File type not allowed', 400);

      // Save to flowkyn_uploads/files/
      const { url } = saveFile(file.buffer, file.originalname, 'files');

      // Store metadata in DB
      const result = await filesService.create(req.user!.userId, url, file.mimetype, file.size);

      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async listMyFiles(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const files = await filesService.listByUser(req.user!.userId);
      res.json(files);
    } catch (err) { next(err); }
  }
}
