import { Response, NextFunction } from 'express';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { emitGameUpdate } from '../socket/emitter';

const gamesService = new GamesService();
const audit = new AuditLogsService();

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

      const { emitEventNotification } = await import('../socket/emitter');
      emitEventNotification(req.params.eventId, 'game:session_created', {
        sessionId: session.id,
        gameTypeId: session.game_type_id,
      });

      await audit.create(null, req.user!.userId, 'GAME_START_SESSION', { eventId: req.params.eventId, sessionId: session.id, gameTypeId: req.body.game_type_id });
      res.status(201).json(session);
    } catch (err) { next(err); }
  }

  async startRound(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const round = await gamesService.startRound(req.params.id);

      emitGameUpdate(req.params.id, 'game:round_started', {
        sessionId: req.params.id,
        roundId: round.id,
        roundNumber: round.round_number,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user!.userId, 'GAME_START_ROUND', { sessionId: req.params.id, roundId: round.id, roundNumber: round.round_number });
      res.status(201).json(round);
    } catch (err) { next(err); }
  }

  async submitAction(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { game_session_id, round_id, participant_id, action_type, payload } = req.body;
      const action = await gamesService.submitAction(game_session_id, round_id, participant_id, action_type, payload);

      emitGameUpdate(game_session_id, 'game:action', {
        userId: req.user!.userId,
        participantId: participant_id,
        actionType: action_type,
        payload,
        timestamp: action.created_at,
      });

      await audit.create(null, req.user!.userId, 'GAME_SUBMIT_ACTION', { sessionId: game_session_id, actionType: action_type });
      res.status(201).json(action);
    } catch (err) { next(err); }
  }

  async finishSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await gamesService.finishSession(req.params.id);

      emitGameUpdate(req.params.id, 'game:ended', {
        sessionId: req.params.id,
        results: result.results,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user!.userId, 'GAME_FINISH_SESSION', { sessionId: req.params.id });
      res.json(result);
    } catch (err) { next(err); }
  }
}
