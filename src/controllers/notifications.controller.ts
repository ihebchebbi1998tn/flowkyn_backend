import { Response, NextFunction } from 'express';
import { NotificationsService } from '../services/notifications.service';
import { AuthRequest } from '../types';

const notificationsService = new NotificationsService();

export class NotificationsController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.list(req.user!.userId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  async markRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.markRead(req.params.id, req.user!.userId);
      res.json(result);
    } catch (err) { next(err); }
  }
}
