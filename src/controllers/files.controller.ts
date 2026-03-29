import { Response, NextFunction } from 'express';
import { FilesService } from '../services/files.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { saveFile, isAllowedFileType } from '../utils/upload';
import { AppError } from '../middleware/errorHandler';

const filesService = new FilesService();
const audit = new AuditLogsService();

export class FilesController {
  async upload(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400, 'FILE_MISSING');
      if (!isAllowedFileType(file.mimetype)) throw new AppError(`File type "${file.mimetype}" is not allowed`, 400, 'FILE_TYPE_NOT_ALLOWED');

      const { url } = saveFile(file.buffer, file.originalname, 'files');
      const result = await filesService.create(req.user!.userId, url, file.mimetype, file.originalname, file.size);

      await audit.create(null, req.user!.userId, 'FILE_UPLOAD', { mimetype: file.mimetype, size: file.size });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async listMyFiles(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await filesService.listByUser(req.user!.userId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }
}
