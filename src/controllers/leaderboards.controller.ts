import { Response, NextFunction } from 'express';
import { LeaderboardsService } from '../services/leaderboards.service';
import { AuthRequest } from '../types';

const leaderboardsService = new LeaderboardsService();

export class LeaderboardsController {
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const lb = await leaderboardsService.getById(req.params.id);
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
