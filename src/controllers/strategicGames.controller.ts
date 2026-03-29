import { Response, NextFunction } from 'express';
import { query, queryOne } from '../config/database';
import { GamesService } from '../services/games.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitGameUpdate } from '../socket/emitter';
import { assertIsEventAdmin, resolveCallerParticipantId } from './helpers/gamesAccess';

const gamesService = new GamesService();
const audit = new AuditLogsService();

export class StrategicGamesController {
  private async resolveParticipantIdForSession(sessionId: string, req: AuthRequest): Promise<string> {
    const session = await gamesService.getSession(sessionId);
    const participantId = await resolveCallerParticipantId(session.event_id, req);
    if (!participantId) throw new AppError('Not a participant in this event', 403, 'NOT_PARTICIPANT');
    return participantId;
  }

  private async assertStrategicRoleAssigned(sessionId: string, participantId: string): Promise<void> {
    const hasRole = await queryOne<{ id: string }>(
      `SELECT id FROM strategic_roles WHERE game_session_id = $1 AND participant_id = $2`,
      [sessionId, participantId]
    );
    if (!hasRole) throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
  }

  async createStrategicSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (req.user) {
        await assertIsEventAdmin(req.params.eventId, req.user.userId);
      } else if (req.guest) {
        // Validate guest belongs to this event
        if (req.guest.eventId !== req.params.eventId) {
          throw new AppError('Forbidden', 403, 'FORBIDDEN');
        }
        const guestParticipant = await queryOne<{ id: string }>(
          `SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND participant_type = 'guest' AND left_at IS NULL`,
          [req.guest.participantId, req.params.eventId]
        );
        if (!guestParticipant) {
          throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
        }
      } else {
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

      const session = await gamesService.createStrategicSession(req.params.eventId, {
        industry: req.body.industry,
        crisisType: req.body.crisisType,
        difficulty: req.body.difficulty,
        industryKey: req.body.industryKey,
        crisisKey: req.body.crisisKey,
        difficultyLabel: req.body.difficultyLabel,
      });

      await audit.create(null, req.user?.userId ?? null, 'GAME_CREATE_STRATEGIC_SESSION', {
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

  async assignStrategicRolesForSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await this.resolveParticipantIdForSession(req.params.sessionId, req);

      const assignments = await gamesService.assignStrategicRoles(req.params.sessionId);

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
        console.error('[StrategicGamesController] Failed to update strategic snapshot after role assignment', snapshotErr);
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

  async getMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);

      const roleRow = await queryOne<{ role_key: string; ready_at: string | null; revealed_at: string | null }>(
        `SELECT role_key, ready_at, revealed_at
         FROM strategic_roles
         WHERE game_session_id = $1 AND participant_id = $2`,
        [req.params.sessionId, participantId]
      );

      res.json(roleRow ? { roleKey: roleRow.role_key, readyAt: roleRow.ready_at, revealedAt: roleRow.revealed_at } : null);
    } catch (err) {
      next(err);
    }
  }

  async acknowledgeMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);
      const sessionId = req.params.sessionId;

      const result = await query(
        `UPDATE strategic_roles
         SET revealed_at = COALESCE(revealed_at, NOW())
         WHERE game_session_id = $1 AND participant_id = $2`,
        [sessionId, participantId]
      );

      if ((result as any)?.rowCount === 0) {
        throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      }

      // Emit updated reveal status to all players in the session
      const row = await queryOne<{ total: string; acknowledged: string }>(
        `WITH assigned AS (
           SELECT sr.participant_id, sr.revealed_at
           FROM strategic_roles sr
           WHERE sr.game_session_id = $1
         )
         SELECT
           (SELECT COUNT(*)::text FROM assigned) as total,
           (SELECT COUNT(*)::text FROM assigned WHERE revealed_at IS NOT NULL) as acknowledged`,
        [sessionId]
      );
      const total = Number(row?.total || 0);
      const acknowledged = Number(row?.acknowledged || 0);
      emitGameUpdate(sessionId, 'strategic:reveal_status', {
        sessionId,
        total,
        acknowledged,
        allAcknowledged: total > 0 && acknowledged >= total,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getStrategicRoleRevealStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await this.resolveParticipantIdForSession(req.params.sessionId, req);

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

  async readyMyStrategicRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);
      const sessionId = req.params.sessionId;

      const result = await query(
        `UPDATE strategic_roles
         SET ready_at = COALESCE(ready_at, NOW())
         WHERE game_session_id = $1 AND participant_id = $2`,
        [sessionId, participantId]
      );

      if ((result as any)?.rowCount === 0) {
        throw new AppError('Role has not been assigned for this session', 409, 'STRATEGIC_ROLE_NOT_ASSIGNED');
      }

      // Emit updated ready status to all players in the session
      const row = await queryOne<{ total: string; ready: string }>(
        `WITH assigned AS (
           SELECT sr.participant_id, sr.ready_at
           FROM strategic_roles sr
           WHERE sr.game_session_id = $1
         )
         SELECT
           (SELECT COUNT(*)::text FROM assigned) as total,
           (SELECT COUNT(*)::text FROM assigned WHERE ready_at IS NOT NULL) as ready`,
        [sessionId]
      );
      const total = Number(row?.total || 0);
      const ready = Number(row?.ready || 0);
      emitGameUpdate(sessionId, 'strategic:ready_status', {
        sessionId,
        total,
        ready,
        allReady: total > 0 && ready >= total,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getStrategicRoleReadyStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await this.resolveParticipantIdForSession(req.params.sessionId, req);

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

  async getMyStrategicRolePromptState(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);

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

  async advanceMyStrategicRolePrompt(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);

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

  async getMyStrategicNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);
      await this.assertStrategicRoleAssigned(req.params.sessionId, participantId);

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

  async updateMyStrategicNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const participantId = await this.resolveParticipantIdForSession(req.params.sessionId, req);
      await this.assertStrategicRoleAssigned(req.params.sessionId, participantId);

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

  async getDebriefResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      if (req.user) {
        await assertIsEventAdmin(session.event_id, req.user.userId);
      } else if (req.guest) {
        if (req.guest.eventId !== session.event_id) throw new AppError('Forbidden', 403, 'FORBIDDEN');
      } else {
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

      const results = await gamesService.getDebriefResults(req.params.sessionId);
      res.json(results);
    } catch (err) {
      next(err);
    }
  }

  async startDebrief(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await gamesService.getSession(req.params.sessionId);

      if (session.status !== 'in_progress') {
        throw new AppError(`Cannot start debrief — session is in '${session.status}' status (expected 'in_progress')`, 400, 'SESSION_NOT_ACTIVE');
      }

      if (session.debrief_sent_at !== null && session.debrief_sent_at !== undefined) {
        throw new AppError('Debrief has already been sent for this session', 400, 'SESSION_ALREADY_FINISHED');
      }

      if (req.user) {
        await assertIsEventAdmin(session.event_id, req.user.userId);
      } else if (req.guest) {
        if (req.guest.eventId !== session.event_id) throw new AppError('Forbidden', 403, 'FORBIDDEN');
      } else {
        throw new AppError('Authorization required', 401, 'AUTH_MISSING_TOKEN');
      }

      const result = await gamesService.startDebrief(req.params.sessionId);

      emitGameUpdate(req.params.sessionId, 'game:debrief_started', {
        sessionId: req.params.sessionId,
        phase: 'debrief',
        resultsCount: result.results.rankings.length,
        timestamp: new Date().toISOString(),
      });

      await audit.create(null, req.user?.userId ?? null, 'GAME_START_DEBRIEF', {
        sessionId: req.params.sessionId,
        resultsCount: result.results.rankings.length,
        participantCount: result.results.participantCount,
        totalActions: result.results.totalActions,
        isGuest: !!req.guest,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
