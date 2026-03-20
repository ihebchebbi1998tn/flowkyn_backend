import { Response, NextFunction, Request } from 'express';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitGameUpdate } from '../socket/emitter';
import { query, queryOne } from '../config/database';

const gamesService = new GamesService();
const audit = new AuditLogsService();

async function allowParticipantGameControlForEvent(eventId: string): Promise<boolean> {
  const row = await queryOne<{ allow: boolean }>(
    `SELECT COALESCE(allow_participant_game_control, true) as allow
     FROM event_settings
     WHERE event_id = $1`,
    [eventId]
  );
  return row ? !!row.allow : true;
}

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

/**
 * Resolve the caller's participant_id for a given event.
 * Supports both guests (from req.guest) and authenticated org members (via participants join).
 */
async function resolveCallerParticipantId(eventId: string, req: AuthRequest): Promise<string | null> {
  if (req.guest) return req.guest.participantId;
  if (!req.user) return null;

  const row = await queryOne<{ id: string }>(
    `SELECT p.id
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [eventId, req.user.userId]
  );
  return row?.id || null;
}

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

  // WebRTC helpers: returns ICE servers (STUN + optional TURN) for client-side peer connections.
  async getIceServers(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stunUrls = (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
        { urls: stunUrls },
      ];

      const turnUrl = process.env.WEBRTC_TURN_URL;
      const turnUsername = process.env.WEBRTC_TURN_USERNAME;
      const turnCredential = process.env.WEBRTC_TURN_CREDENTIAL;

      // If TURN is not configured, we still return STUN-only.
      if (turnUrl) {
        if (!turnUsername || !turnCredential) {
          throw new AppError('TURN credentials are not configured', 500, 'INTERNAL_ERROR');
        }

        // coturn typical format: turn:host:3478 (or turns:host:5349 for TLS)
        iceServers.push({
          urls: [turnUrl],
          username: turnUsername,
          credential: turnCredential,
        });
      }

      res.json({ iceServers });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Testing helper — returns ICE servers (STUN + optional TURN) WITHOUT any Authorization header.
   * Useful for verifying coturn connectivity/credentials via plain curl.
   *
   * SECURITY NOTE: This endpoint exposes TURN credentials to anyone who can reach the API.
   * Use it only for testing and remove/lock it down in production if needed.
   */
  async getIceServersPublic(_req: Request, res: Response, next: NextFunction) {
    try {
      const stunUrls = (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
        { urls: stunUrls },
      ];

      const turnUrl = process.env.WEBRTC_TURN_URL;
      const turnUsername = process.env.WEBRTC_TURN_USERNAME;
      const turnCredential = process.env.WEBRTC_TURN_CREDENTIAL;

      // If TURN is not configured, we still return STUN-only.
      if (turnUrl) {
        if (!turnUsername || !turnCredential) {
          throw new AppError('TURN credentials are not configured', 500, 'INTERNAL_ERROR');
        }

        iceServers.push({
          urls: [turnUrl],
          username: turnUsername,
          credential: turnCredential,
        });
      }

      res.json({ iceServers });
    } catch (err) {
      next(err);
    }
  }

  async startSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const callerInfo = {
        userId: req.user?.userId ?? null,
        guestParticipantId: req.guest?.participantId ?? null,
        guestTokenEventId: req.guest?.eventId ?? null,
      };
      console.log('[GamesController] startSession', { eventId, ...callerInfo });

      // When ALLOW_PARTICIPANT_GAME_CONTROL=true:
      // - authenticated users: allow members to start
      // - guests: allow guests (participant records) to start
      // When false:
      // - authenticated users: only owner/admin/moderator
      // - guests: forbid (no org role available)
      const allow = await allowParticipantGameControlForEvent(eventId);

      if (req.user) {
      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
          [eventId, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');

      if (!allow && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can start game sessions', 403, 'INSUFFICIENT_PERMISSIONS');
        }
      } else if (req.guest) {
        // Defense-in-depth: make sure the guest token is for the same event being requested.
        if (req.guest.eventId !== eventId) {
          throw new AppError('Forbidden', 403, 'FORBIDDEN');
        }

        const guestParticipant = await queryOne<{ id: string }>(
          `SELECT id
           FROM participants
           WHERE id = $1
             AND event_id = $2
             AND participant_type = 'guest'
             AND left_at IS NULL`,
          [req.guest.participantId, eventId]
        );
        if (!guestParticipant) {
          throw new AppError('You are not a participant in this event.', 403, 'NOT_PARTICIPANT');
        }

        if (!allow) {
          throw new AppError('Forbidden', 403, 'FORBIDDEN');
        }
      } else {
        // Should not happen because this route uses authenticateOrGuest.
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

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

      console.log('[GamesController] startSession created', {
        eventId,
        sessionId: session.id,
        gameTypeId: session.game_type_id,
        allowParticipantGameControl: allow,
        startedAsGuest: !!req.guest,
      });
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
      const allow = await allowParticipantGameControlForEvent(session.event_id);
      if (!allow && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
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
      const allow = await allowParticipantGameControlForEvent(session.event_id);
      if (!allow && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
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

  /**
   * Strategic Escape Challenge — create a configured session for an event.
   */
  async createStrategicSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can create strategic sessions', 403, 'FORBIDDEN');

      // Ensure caller is admin/moderator/owner for this event's organization
      const member = await queryOne<{ role_name: string }>(
        `SELECT r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [req.params.eventId, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can create strategic sessions', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const session = await gamesService.createStrategicSession(req.params.eventId, {
        industry: req.body.industry,
        crisisType: req.body.crisisType,
        difficulty: req.body.difficulty,
        industryKey: req.body.industryKey,
        crisisKey: req.body.crisisKey,
        difficultyLabel: req.body.difficultyLabel,
      });

      await audit.create(null, req.user.userId, 'GAME_CREATE_STRATEGIC_SESSION', {
        eventId: req.params.eventId,
        sessionId: session.id,
        config: req.body,
      });

      res.status(201).json({
        sessionId: session.id,
        eventId: session.event_id,
        config: req.body,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — assign roles to participants.
   * This endpoint supports both authenticated users and guests (event-scoped guest tokens).
   *
   * NOTE: Per requirements, this does NOT send emails. Role delivery is handled in-app.
   */
  async assignStrategicRolesForSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      // Require caller to be a participant (member or guest) in this event, to avoid blind triggers.
      let participantId: string | null = null;
      if (req.guest) {
        participantId = req.guest.participantId;
      } else if (req.user) {
        const row = await queryOne<{ id: string }>(
          `SELECT p.id
           FROM participants p
           JOIN organization_members om ON om.id = p.organization_member_id
           WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
          [session.event_id, req.user.userId]
        );
        participantId = row?.id || null;
      }

      if (!participantId) {
        throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');
      }

      const belongs = await queryOne<{ id: string }>(
        `SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND left_at IS NULL`,
        [participantId, session.event_id]
      );
      if (!belongs) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const assignments = await gamesService.assignStrategicRoles(req.params.sessionId);

      // Update strategic snapshot so frontends see the new phase/flag even if no socket action is sent
      try {
        const latest = await gamesService.getLatestSnapshot(req.params.sessionId);
        const state = latest?.state as any;

        if (state && state.kind === 'strategic-escape') {
          const nextState = {
            ...state,
            rolesAssigned: true,
            phase: 'roles_assignment',
          };

          await gamesService.saveSnapshot(req.params.sessionId, nextState);
          emitGameUpdate(req.params.sessionId, 'game:data', {
            sessionId: req.params.sessionId,
            gameData: nextState,
          });
        }
      } catch (snapshotErr) {
        // Non-fatal: log and continue
        // eslint-disable-next-line no-console
        console.error('[GamesController] Failed to update strategic snapshot after role assignment', snapshotErr);
      }

      await audit.create(null, req.user?.userId ?? null, 'GAME_ASSIGN_STRATEGIC_ROLES', {
        sessionId: req.params.sessionId,
        assignmentsCount: assignments.length,
      });

      res.status(200).json({ assignments });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get current caller's role for a session.
   */
  async getMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      let participantId: string | null = null;

      if (req.guest) {
        participantId = req.guest.participantId;
      } else if (req.user) {
        const row = await queryOne<{ id: string }>(
          `SELECT p.id
           FROM participants p
           JOIN organization_members om ON om.id = p.organization_member_id
           WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
          [session.event_id, req.user.userId]
        );
        participantId = row?.id || null;
      }

      if (!participantId) {
        throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');
      }

      const roleRow = await queryOne<{ role_key: string; ready_at: string | null; revealed_at: string | null }>(
        `SELECT role_key, ready_at, revealed_at
         FROM strategic_roles
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      res.json(
        roleRow
          ? { roleKey: roleRow.role_key, readyAt: roleRow.ready_at, revealedAt: roleRow.revealed_at }
          : null
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — acknowledge that the current participant has revealed/closed their role modal.
   * Supports both authenticated members and guests.
   */
  async acknowledgeMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      let participantId: string | null = null;
      if (req.guest) {
        participantId = req.guest.participantId;
      } else if (req.user) {
        const row = await queryOne<{ id: string }>(
          `SELECT p.id
           FROM participants p
           JOIN organization_members om ON om.id = p.organization_member_id
           WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
          [session.event_id, req.user.userId]
        );
        participantId = row?.id || null;
      }

      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const result = await query(
        `UPDATE strategic_roles
         SET revealed_at = COALESCE(revealed_at, NOW())
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      if ((result as any)?.rowCount === 0) {
        throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get aggregate role reveal acknowledgement status for the session.
   * Returns counts only (no identities) to avoid leaking who has which role.
   */
  async getStrategicRoleRevealStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      // Require caller to be a participant (member or guest) in this event.
      let participantId: string | null = null;
      if (req.guest) {
        participantId = req.guest.participantId;
      } else if (req.user) {
        const row = await queryOne<{ id: string }>(
          `SELECT p.id
           FROM participants p
           JOIN organization_members om ON om.id = p.organization_member_id
           WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
          [session.event_id, req.user.userId]
        );
        participantId = row?.id || null;
      }

      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const row = await queryOne<{ total: string; acknowledged: string }>(
        `WITH assigned AS (
           SELECT sr.participant_id, sr.revealed_at
           FROM strategic_roles sr
           WHERE sr.game_session_id = $1
         )
         SELECT
           (SELECT COUNT(*)::text FROM assigned) as total,
           (SELECT COUNT(*)::text FROM assigned WHERE revealed_at IS NOT NULL) as acknowledged`,
        [req.params.sessionId]
      );

      const total = Number(row?.total || 0);
      const acknowledged = Number(row?.acknowledged || 0);
      res.json({ total, acknowledged, allAcknowledged: total > 0 && acknowledged >= total });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — mark current participant as "ready" (guest-safe).
   */
  async readyMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const result = await query(
        `UPDATE strategic_roles
         SET ready_at = COALESCE(ready_at, NOW())
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      if ((result as any)?.rowCount === 0) {
        throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get aggregate "ready" status for the session (counts only).
   */
  async getStrategicRoleReadyStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const row = await queryOne<{ total: string; ready: string }>(
        `WITH assigned AS (
           SELECT sr.participant_id, sr.ready_at
           FROM strategic_roles sr
           WHERE sr.game_session_id = $1
         )
         SELECT
           (SELECT COUNT(*)::text FROM assigned) as total,
           (SELECT COUNT(*)::text FROM assigned WHERE ready_at IS NOT NULL) as ready`,
        [req.params.sessionId]
      );

      const total = Number(row?.total || 0);
      const ready = Number(row?.ready || 0);
      res.json({ total, ready, allReady: total > 0 && ready >= total });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get current participant's prompt state (index + last update).
   */
  async getMyStrategicRolePromptState(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const row = await queryOne<{ prompt_index: number; prompt_updated_at: string | null }>(
        `SELECT prompt_index, prompt_updated_at
         FROM strategic_roles
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      if (!row) throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      res.json({ promptIndex: row.prompt_index ?? 0, promptUpdatedAt: row.prompt_updated_at });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — advance current participant to the next prompt (idempotent by increment).
   */
  async advanceMyStrategicRolePrompt(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const row = await queryOne<{ prompt_index: number; prompt_updated_at: string }>(
        `UPDATE strategic_roles
         SET prompt_index = COALESCE(prompt_index, 0) + 1,
             prompt_updated_at = NOW()
         WHERE game_session_id = $1 AND participant_id = $2
         RETURNING prompt_index, prompt_updated_at`,
        [req.params.sessionId, participantId]
      );

      if (!row) throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      res.json({ promptIndex: row.prompt_index ?? 0, promptUpdatedAt: row.prompt_updated_at });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get current participant's private notes for this session.
   */
  async getMyStrategicNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      // Guard: only allow notes if the role exists for this participant/session (same principle as revealed_at)
      const hasRole = await queryOne<{ id: string }>(
        `SELECT id FROM strategic_roles WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );
      if (!hasRole) throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');

      const row = await queryOne<{ content: string; updated_at: string }>(
        `SELECT content, updated_at
         FROM strategic_notes
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      res.json({ content: row?.content ?? '', updatedAt: row?.updated_at ?? null });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — upsert current participant's private notes for this session.
   */
  async updateMyStrategicNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);
      const participantId = await resolveCallerParticipantId(session.event_id, req);
      if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');

      const hasRole = await queryOne<{ id: string }>(
        `SELECT id FROM strategic_roles WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );
      if (!hasRole) throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');

      const content = (req.body?.content ?? '') as string;

      const row = await queryOne<{ content: string; updated_at: string }>(
        `INSERT INTO strategic_notes (id, game_session_id, participant_id, content)
         VALUES (uuid_generate_v4(), $1, $2, $3)
         ON CONFLICT (game_session_id, participant_id)
         DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
         RETURNING content, updated_at`,
        [req.params.sessionId, participantId, content]
      );

      res.json({ content: row?.content ?? content, updatedAt: row?.updated_at ?? null });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — get debrief results for a session.
   * Returns aggregated rankings, action counts, and statistics.
   */
  async getDebriefResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can view debrief results', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.sessionId);

      // Verify caller is admin/moderator of the event's organization
      const member = await queryOne<{ role_name: string }>(
        `SELECT r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );

      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can view debrief results', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const results = await gamesService.getDebriefResults(req.params.sessionId);
      res.json(results);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Strategic Escape Challenge — start the debrief phase.
   * Calculates final results, updates session state, and emits notifications.
   */
  async startDebrief(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can start debrief', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.sessionId);

      // Validate session state — can only start debrief if in progress
      if (session.status !== 'in_progress') {
        throw new AppError(`Cannot start debrief — session is in '${session.status}' status (expected 'in_progress')`, 400, 'SESSION_NOT_ACTIVE');
      }

      // Validate session hasn't already sent debrief
      if (session.debrief_sent_at !== null && session.debrief_sent_at !== undefined) {
        throw new AppError('Debrief has already been sent for this session', 400, 'SESSION_ALREADY_FINISHED');
      }

      // Verify caller is admin/moderator of the event's organization
      const member = await queryOne<{ role_name: string }>(
        `SELECT r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [session.event_id, req.user.userId]
      );

      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can start debrief', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const result = await gamesService.startDebrief(req.params.sessionId);

      // Emit WebSocket event to notify all participants
      emitGameUpdate(req.params.sessionId, 'game:debrief_started', {
        sessionId: req.params.sessionId,
        phase: 'debrief',
        resultsCount: result.results.rankings.length,
        timestamp: new Date().toISOString(),
      });

      // Log audit trail
      await audit.create(null, req.user.userId, 'GAME_START_DEBRIEF', {
        sessionId: req.params.sessionId,
        resultsCount: result.results.rankings.length,
        participantCount: result.results.participantCount,
        totalActions: result.results.totalActions,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
