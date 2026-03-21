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

  async getEngagementMetrics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { organizationId } = req.params;
      const metrics = await analyticsService.getEngagementMetrics(req.user!.userId, organizationId);
      res.json(metrics);
    } catch (err) { next(err); }
  }

  async getRealTimeMetrics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { organizationId } = req.params;
      const metrics = await analyticsService.getRealTimeMetrics(req.user!.userId, organizationId);
      res.json(metrics);
    } catch (err) { next(err); }
  }

  async getEventAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { eventId } = req.params;
      const analytics = await analyticsService.getEventAnalytics(req.user!.userId, eventId);
      res.json(analytics);
    } catch (err) { next(err); }
  }

  async getParticipantRankings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { organizationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const rankings = await analyticsService.getParticipantRankings(req.user!.userId, organizationId, limit);
      res.json(rankings);
    } catch (err) { next(err); }
  }
}
