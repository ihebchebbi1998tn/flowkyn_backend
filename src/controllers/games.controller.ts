import { Response, NextFunction, Request } from 'express';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitGameUpdate } from '../socket/emitter';
import { assertCanStartSession } from './helpers/startSessionAccess';
import {
  allowParticipantGameControlForEvent,
  verifyParticipantOwnership,
  assertCanControlGameSession,
  assertCanViewSessionAdmin,
} from './helpers/gamesAccess';
import { buildIceServersConfig } from '../utils/iceServers';

const gamesService = new GamesService();
const audit = new AuditLogsService();

export class GamesController {
  async listGameTypes(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const types = await gamesService.listGameTypes();
      res.json(types);
    } catch (err) { next(err); }
  }

  /**
   * GET /game-types/:id/prompts — List prompts for a game type.
   */
  async listPrompts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const gameTypeId = req.params.id;
      const category = (req.query.category as string | undefined) || undefined;
      const prompts = await gamesService.getPrompts(gameTypeId, category);
      res.json(prompts);
    } catch (err) {
      next(err);
    }
  }

  async getIceServers(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const iceServers = buildIceServersConfig();
      res.json({ iceServers });
    } catch (err) {
      if (err instanceof Error) next(new AppError(err.message, 500, 'INTERNAL_ERROR'));
      else next(err);
    }
  }

  /**
   * Testing helper — returns ICE servers (STUN + optional TURN) WITHOUT any Authorization header.
   * SECURITY NOTE: This endpoint exposes TURN credentials. Use only for testing.
   */
  async getIceServersPublic(_req: Request, res: Response, next: NextFunction) {
    try {
      const iceServers = buildIceServersConfig();
      res.json({ iceServers });
    } catch (err) { next(err); }
  }

  async startSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;

      // When ALLOW_PARTICIPANT_GAME_CONTROL=true:
      // - authenticated users: allow members to start
      // - guests: allow guests (participant records) to start
      // When false:
      // - authenticated users: only owner/admin/moderator
      // - guests: forbid (no org role available)
      const allow = await allowParticipantGameControlForEvent(eventId);
      await assertCanStartSession(req, eventId, allow);

      const { game_type_id, total_rounds } = req.body;
      const session = await gamesService.startSession(eventId, game_type_id, total_rounds);

      const { emitEventNotification } = await import('../socket/emitter');
      emitEventNotification(eventId, 'game:session_created', {
        sessionId: session.id,
        gameTypeId: session.game_type_id,
      });

      await audit.create(
        null,
        req.user?.userId ?? null,
        'GAME_START_SESSION',
        {
          eventId,
          sessionId: session.id,
          gameTypeId: req.body.game_type_id,
          startedAsGuest: !!req.guest,
          guestParticipantId: req.guest?.participantId ?? null,
        }
      );

      res.status(201).json(session);
    } catch (err) { next(err); }
  }

  /**
   * GET /events/:eventId/game-sessions/active
   *
   * Resolve the currently active game session for a given event + game type key.
   * Supports both authenticated users and guests (via authenticateOrGuest).
   * Returns null if no active session exists.
   */
  async getActiveSessionForEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const gameKey = (req.query.game_key as string | undefined)?.trim();
      
      let session;
      if (gameKey) {
        session = await gamesService.getActiveSessionByEventAndKey(req.params.eventId, gameKey);
      } else {
        session = await gamesService.getLatestActiveSessionForEvent(req.params.eventId);
      }

      // For easier client handling, always return 200 with either a session object or null.
      res.json(session || null);
    } catch (err) {
      next(err);
    }
  }

  async startRound(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.id);
      const allow = await allowParticipantGameControlForEvent(session.event_id);

      if (req.user) {
        await assertCanControlGameSession(session.event_id, req.user.userId, allow);
      } else if (req.guest) {
        // Guests can start rounds when participant game control is allowed
        if (!allow) throw new AppError('Only admins can start rounds', 403, 'FORBIDDEN');
        if (req.guest.eventId !== session.event_id) throw new AppError('Forbidden', 403, 'FORBIDDEN');
      } else {
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

      const round = await gamesService.startRound(req.params.id);

      emitGameUpdate(req.params.id, 'game:round_started', {
        sessionId: req.params.id,
        roundId: round.id,
        roundNumber: round.round_number,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user?.userId ?? null, 'GAME_START_ROUND', { sessionId: req.params.id, roundId: round.id, roundNumber: round.round_number, isGuest: !!req.guest });
      res.status(201).json(round);
    } catch (err) { next(err); }
  }

  /**
   * Submit a game action — supports BOTH authenticated users AND guests.
   * Uses authenticateOrGuest middleware, so req.user OR req.guest is set.
   */
  async submitAction(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { game_session_id, round_id, participant_id, action_type, payload } = req.body;

      await verifyParticipantOwnership(participant_id, req);

      const action = await gamesService.submitAction(game_session_id, round_id, participant_id, action_type, payload);

      const callerId = req.user?.userId || `guest:${req.guest?.participantId}`;

      emitGameUpdate(game_session_id, 'game:action', {
        userId: callerId,
        participantId: participant_id,
        actionType: action_type,
        payload,
        timestamp: action.created_at,
      });

      await audit.create(null, req.user?.userId || null, 'GAME_SUBMIT_ACTION', {
        sessionId: game_session_id,
        actionType: action_type,
        isGuest: !!req.guest,
        participantId: participant_id,
      });
      res.status(201).json(action);
    } catch (err) { next(err); }
  }

  async finishSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.id);
      const allow = await allowParticipantGameControlForEvent(session.event_id);

      if (req.user) {
        await assertCanControlGameSession(session.event_id, req.user.userId, allow);
      } else if (req.guest) {
        if (!allow) throw new AppError('Only admins can finish sessions', 403, 'FORBIDDEN');
        if (req.guest.eventId !== session.event_id) throw new AppError('Forbidden', 403, 'FORBIDDEN');
      } else {
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

      const result = await gamesService.finishSession(req.params.id);

      emitGameUpdate(req.params.id, 'game:ended', {
        sessionId: req.params.id,
        results: result.results,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user?.userId ?? null, 'GAME_FINISH_SESSION', { sessionId: req.params.id, isGuest: !!req.guest });
      res.json(result);
    } catch (err) { next(err); }
  }

  async getSessionActions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can view actions', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.id);
      await assertCanViewSessionAdmin(session.event_id, req.user.userId);

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const actions = await gamesService.getSessionActions(req.params.id, limit, offset);
      res.json(actions);
    } catch (err) { next(err); }
  }

  async getSessionSnapshots(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can view snapshots', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.id);
      await assertCanViewSessionAdmin(session.event_id, req.user.userId);

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const snapshots = await gamesService.getSessionSnapshots(req.params.id, limit, offset);
      res.json(snapshots);
    } catch (err) { next(err); }
  }
}
