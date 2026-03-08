import { Response, NextFunction } from 'express';
import { GamesService } from '../services/games.service';
import { AuthRequest } from '../types';
import { emitGameUpdate } from '../socket/emitter';

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

      // Notify event room that a game session started
      const { emitEventNotification } = await import('../socket/emitter');
      emitEventNotification(req.params.eventId, 'game:session_created', {
        sessionId: session.id,
        gameTypeId: session.game_type_id,
      });

      res.status(201).json(session);
    } catch (err) { next(err); }
  }

  async startRound(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const round = await gamesService.startRound(req.params.id);

      // Broadcast to game session room
      emitGameUpdate(req.params.id, 'game:round_started', {
        sessionId: req.params.id,
        roundId: round.id,
        roundNumber: round.round_number,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json(round);
    } catch (err) { next(err); }
  }

  async submitAction(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { game_session_id, round_id, participant_id, action_type, payload } = req.body;
      const action = await gamesService.submitAction(game_session_id, round_id, participant_id, action_type, payload);

      // Broadcast to game session room
      emitGameUpdate(game_session_id, 'game:action', {
        userId: req.user!.userId,
        participantId: participant_id,
        actionType: action_type,
        payload,
        timestamp: action.created_at,
      });

      res.status(201).json(action);
    } catch (err) { next(err); }
  }

  async finishSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await gamesService.finishSession(req.params.id);

      // Broadcast final results
      emitGameUpdate(req.params.id, 'game:ended', {
        sessionId: req.params.id,
        results: result.results,
        timestamp: new Date().toISOString(),
      });

      res.json(result);
    } catch (err) { next(err); }
  }
}
