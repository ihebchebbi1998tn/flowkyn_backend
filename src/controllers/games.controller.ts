import { Response, NextFunction } from 'express';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitGameUpdate } from '../socket/emitter';
import { query, queryOne } from '../config/database';
import { sendEmail } from '../services/email.service';
import { env } from '../config/env';
import { getStrategicRoleContent } from '../emails/strategicRoleContent';

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

  async startSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Authorization: default is admins/moderators only. When ALLOW_PARTICIPANT_GAME_CONTROL=true,
      // any active/pending org member can start a session for the event.
      if (!req.user) throw new AppError('Only authenticated users can start game sessions', 403, 'FORBIDDEN');

      const member = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         JOIN events e ON e.organization_id = om.organization_id
         WHERE e.id = $1 AND om.user_id = $2 AND om.status IN ('active', 'pending')`,
        [req.params.eventId, req.user.userId]
      );
      if (!member) throw new AppError('You are not a member of this event\'s organization', 403, 'NOT_A_MEMBER');
      const allow = await allowParticipantGameControlForEvent(req.params.eventId);
      if (!allow && !['owner', 'admin', 'moderator'].includes(member.role_name)) {
        throw new AppError('Only admins and moderators can start game sessions', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const { game_type_id, total_rounds } = req.body;
      const session = await gamesService.startSession(req.params.eventId, game_type_id, total_rounds);

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
   * Strategic Escape Challenge — assign roles to participants and send emails.
   */
  async assignStrategicRolesForSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Only authenticated users can assign roles', 403, 'FORBIDDEN');

      const session = await gamesService.getSession(req.params.sessionId);
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
        throw new AppError('Only admins and moderators can assign roles', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const assignments = await gamesService.assignStrategicRoles(req.params.sessionId);

      if (assignments.length > 0) {
        // Load context for emails: event + organization and scenario info from latest snapshot
        const eventRow = await queryOne<{ title: string; organization_name: string }>(
          `SELECT e.title, o.name as organization_name
           FROM events e
           JOIN organizations o ON o.id = e.organization_id
           WHERE e.id = $1`,
          [session.event_id]
        );

        const snapshot = await gamesService.getLatestSnapshot(req.params.sessionId);
        const state = snapshot?.state as any;

        // Prefer label fields; avoid sending translation-key strings in emails.
        const industryLabel =
          state?.industryLabel ||
          state?.industry ||
          'General';
        const crisisLabel =
          state?.crisisLabel ||
          state?.crisisType ||
          'Scenario';
        const difficultyLabel =
          state?.difficultyLabel ||
          state?.difficulty ||
          'medium';

        const frontendBase = env.frontendUrl;
        const eventLink = `${frontendBase}/join/${session.event_id}`;

        // Fetch participant + user details for assignments
        const participantIds = assignments.map(a => a.participantId);
        const participantRows = await query<{
          id: string;
          name: string | null;
          email: string | null;
          language: string | null;
        }>(
          `SELECT p.id,
                  COALESCE(ep.display_name, p.guest_name, u.name) as name,
                  COALESCE(u.email, NULL) as email,
                  u.language as language
           FROM participants p
           LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
           LEFT JOIN organization_members om ON om.id = p.organization_member_id
           LEFT JOIN users u ON u.id = om.user_id
           WHERE p.id = ANY($1::uuid[])`,
          [participantIds]
        );

        const byId = new Map(participantRows.map((r: typeof participantRows[0]) => [r.id, r]));

        for (const a of assignments) {
          const row = byId.get(a.participantId);
          if (!row || !row.email) continue;

          const roleContent = getStrategicRoleContent(a.roleKey, row.language || 'en');
          if (!roleContent) continue;

          await sendEmail({
            to: row.email,
            type: 'strategic_role_assignment',
            data: {
              name: row.name || '',
              orgName: eventRow?.organization_name || 'Flowkyn',
              eventTitle: eventRow?.title || 'Strategic Escape Challenge',
              industryLabel,
              crisisLabel,
              difficultyLabel,
              roleName: roleContent.name,
              roleBrief: roleContent.brief,
              roleSecretInstructions: roleContent.secret,
              eventLink,
            },
            lang: row.language || 'en',
          });
        }

        // Mark email_sent_at for all newly assigned rows
        await query(
          `UPDATE strategic_roles
           SET email_sent_at = NOW()
           WHERE game_session_id = $1
             AND participant_id = ANY($2::uuid[])
             AND email_sent_at IS NULL`,
          [req.params.sessionId, participantIds]
        );
      }

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

      await audit.create(null, req.user.userId, 'GAME_ASSIGN_STRATEGIC_ROLES', {
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

      const roleRow = await queryOne<{ role_key: string }>(
        `SELECT role_key
         FROM strategic_roles
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      res.json(roleRow ? { roleKey: roleRow.role_key } : null);
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
