import { Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';

const analyticsService = new AnalyticsService();
const audit = new AuditLogsService();

export class AnalyticsController {
  async track(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await analyticsService.track(req.user!.userId, req.body.event_name, req.body.properties);
      await audit.create(null, req.user!.userId, 'ANALYTICS_TRACK', { eventName: req.body.event_name });
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
