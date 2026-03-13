import { Response, NextFunction } from 'express';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitGameUpdate } from '../socket/emitter';
import { queryOne } from '../config/database';

const gamesService = new GamesService();
const audit = new AuditLogsService();

/**
 * Verify the caller owns the given participant_id.
 * Supports both authenticated org members AND guest participants.
 */
async function verifyParticipantOwnership(participantId: string, req: AuthRequest): Promise<void> {
  // If this is a guest request, verify the guest token's participantId matches
  if (req.guest) {
    if (req.guest.participantId !== participantId) {
      throw new AppError('Guest token does not match the provided participant_id', 403, 'FORBIDDEN');
    }
    // Verify participant still exists and is active
    const guestRow = await queryOne(
      `SELECT id FROM participants WHERE id = $1 AND participant_type = 'guest' AND left_at IS NULL`,
      [participantId]
    );
    if (!guestRow) throw new AppError('Guest participant not found or has left', 403, 'FORBIDDEN');
    return;
  }

  // Authenticated user — check org-member participant
  if (req.user) {
    const memberRow = await queryOne(
      `SELECT p.id FROM participants p
       JOIN organization_members om ON om.id = p.organization_member_id
       WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
      [participantId, req.user.userId]
    );
    if (memberRow) return;
  }

  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}

export class GamesController {
  async listGameTypes(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const types = await gamesService.listGameTypes();
      res.json(types);
    } catch (err) { next(err); }
  }

  async startSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Authorization: only admins/moderators can start game sessions
      if (!req.user) throw new AppError('Only authenticated users can start game sessions', 403, 'FORBIDDEN');

      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [req.params.eventId, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can start game sessions', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const session = await gamesService.startSession(req.params.eventId, req.body.game_type_id);

      const { emitEventNotification } = await import('../socket/emitter');
      emitEventNotification(req.params.eventId, 'game:session_created', {
        sessionId: session.id,
        gameTypeId: session.game_type_id,
      });

      await audit.create(null, req.user.userId, 'GAME_START_SESSION', { eventId: req.params.eventId, sessionId: session.id, gameTypeId: req.body.game_type_id });
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
      if (!gameKey) {
        throw new AppError('game_key query parameter is required', 400, 'VALIDATION_FAILED');
      }

      const session = await gamesService.getActiveSessionByEventAndKey(req.params.eventId, gameKey);

      // For easier client handling, always return 200 with either a session object or null.
      res.json(session || null);
    } catch (err) {
      next(err);
    }
  }

  async startRound(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can start rounds', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.id);
      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can start rounds', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const round = await gamesService.startRound(req.params.id);

      emitGameUpdate(req.params.id, 'game:round_started', {
        sessionId: req.params.id,
        roundId: round.id,
        roundNumber: round.round_number,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user.userId, 'GAME_START_ROUND', { sessionId: req.params.id, roundId: round.id, roundNumber: round.round_number });
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
      if (!req.user) throw new AppError('Only authenticated users can finish game sessions', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.id);
      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can finish game sessions', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const result = await gamesService.finishSession(req.params.id);

      emitGameUpdate(req.params.id, 'game:ended', {
        sessionId: req.params.id,
        results: result.results,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user.userId, 'GAME_FINISH_SESSION', { sessionId: req.params.id });
      res.json(result);
    } catch (err) { next(err); }
  }

  async getSessionActions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can view actions', 403, 'FORBIDDEN');
      
      const session = await gamesService.getSession(req.params.id);
      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can view actions', 403, 'INSUFFICIENT_PERMISSIONS');
      }

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
      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can view snapshots', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const snapshots = await gamesService.getSessionSnapshots(req.params.id, limit, offset);
      res.json(snapshots);
    } catch (err) { next(err); }
  }
}
