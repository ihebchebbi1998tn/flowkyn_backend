import { Response, NextFunction } from 'express';
import { LeaderboardsService } from '../services/leaderboards.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';

const leaderboardsService = new LeaderboardsService();
const audit = new AuditLogsService();

export class LeaderboardsController {
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const lb = await leaderboardsService.getById(req.params.id);
      await audit.create(null, req.user!.userId, 'LEADERBOARD_VIEW', { leaderboardId: req.params.id });
      res.json(lb);
    } catch (err) { next(err); }
  }

  async getEntries(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const entries = await leaderboardsService.getEntries(req.params.id);
      res.json(entries);
    } catch (err) { next(err); }
  }
}
