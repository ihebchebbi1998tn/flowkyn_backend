import { Response, NextFunction } from 'express';
import { hrAnalyticsService } from '../services/hrAnalytics.service';
import { AuthRequest } from '../types';

export class HRAnalyticsController {
  async getDashboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { organizationId } = req.params;
      const dashboard = await hrAnalyticsService.getDashboard(req.user!.userId, organizationId);
      res.json(dashboard);
    } catch (err) { next(err); }
  }
}
