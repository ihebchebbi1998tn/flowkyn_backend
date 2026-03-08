import { Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { AuthRequest } from '../types';

const analyticsService = new AnalyticsService();

export class AnalyticsController {
  async track(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await analyticsService.track(req.user!.userId, req.body.event_name, req.body.properties);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async getDashboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await analyticsService.getDashboardStats(req.user!.userId);
      res.json(stats);
    } catch (err) { next(err); }
  }

  async getOverview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const months = parseInt(req.query.months as string) || 6;
      const overview = await analyticsService.getOverview(req.user!.userId, months);
      res.json(overview);
    } catch (err) { next(err); }
  }

  async getActiveSessions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const sessions = await analyticsService.getActiveSessions(req.user!.userId);
      res.json(sessions);
    } catch (err) { next(err); }
  }
}
