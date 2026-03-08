import { Response, NextFunction } from 'express';
import { GamesService } from '../services/games.service';
import { AuthRequest } from '../types';

const gamesService = new GamesService();

export class GamesController {
  async listGameTypes(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const types = await gamesService.listGameTypes();
      res.json(types);
    } catch (err) { next(err); }
  }

  async startSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.startSession(req.params.eventId, req.body.game_type_id);
      res.status(201).json(session);
    } catch (err) { next(err); }
  }

  async startRound(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const round = await gamesService.startRound(req.params.id);
      res.status(201).json(round);
    } catch (err) { next(err); }
  }

  async submitAction(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { game_session_id, round_id, participant_id, action_type, payload } = req.body;
      const action = await gamesService.submitAction(game_session_id, round_id, participant_id, action_type, payload);
      res.status(201).json(action);
    } catch (err) { next(err); }
  }

  async finishSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await gamesService.finishSession(req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  }
}
