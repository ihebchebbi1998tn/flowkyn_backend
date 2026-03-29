/**
 * Strategic Escape game-specific operations: session creation, role assignment, debrief.
 */
import { query, queryOne, transaction } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { GameSessionCoreService } from './sessionCore.service';

export class StrategicEscapeService extends GameSessionCoreService {
  /**
   * Create a Strategic Escape session with initial configuration snapshot and discussion timeout.
   */
  async createStrategicSession(
    eventId: string,
    config: {
      industry: string;
      crisisType: string;
      difficulty: string;
      industryKey?: string;
      crisisKey?: string;
      difficultyLabel?: string;
      discussionDurationMinutes?: number;
    }
  ) {
    const gameType = await this.getGameTypeByKey('strategic-escape');
    if (!gameType) throw new AppError('Strategic Escape game type not found', 404, 'NOT_FOUND');

    const session = await this.startSession(eventId, gameType.id);

    const resolvedTiming = (session as any)?.resolved_timing as any;
    const sessionStrategicDefault = Number(resolvedTiming?.strategicEscape?.discussionDurationMinutes || 45);
    const durationMinutes = config.discussionDurationMinutes || sessionStrategicDefault;
    const discussionEndsAtRaw = new Date(Date.now() + durationMinutes * 60 * 1000);
    const discussionEndsAt = this.clampToEventEnd(
      this.clampToEventEnd(discussionEndsAtRaw, (session as any)?.session_deadline_at || null),
      (await queryOne<{ end_time: string | null }>('SELECT end_time FROM events WHERE id = $1', [eventId]))?.end_time || null
    ) || discussionEndsAtRaw;

    await query(
      `UPDATE game_sessions SET discussion_ends_at = $1 WHERE id = $2`,
      [discussionEndsAt, session.id]
    );

    const initialState = {
      kind: 'strategic-escape',
      phase: 'setup',
      industryKey: config.industryKey || null,
      crisisKey: config.crisisKey || null,
      difficultyKey: config.difficulty,
      industryLabel: config.industry,
      crisisLabel: config.crisisType,
      difficultyLabel: config.difficultyLabel || config.difficulty,
      rolesAssigned: false,
      discussionDurationMinutes: durationMinutes,
      discussionEndsAt: discussionEndsAt.toISOString(),
    };

    await this.saveSnapshot(session.id, initialState);
    return session;
  }

  /**
   * Assign strategic roles to all active participants using SERIALIZABLE isolation.
   */
  async assignStrategicRoles(sessionId: string) {
    const { assignRolesToParticipants } = await import('../roleDefinitions');

    const result = await transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');
      if (session.status !== 'active') throw new AppError('Session is not active', 400, 'SESSION_NOT_ACTIVE');

      // Idempotency: return existing assignments
      const { rows: existing } = await client.query(
        `SELECT participant_id, role_key FROM strategic_roles WHERE game_session_id = $1`,
        [sessionId]
      );
      if (existing.length > 0) {
        return existing.map((row: any) => ({
          participantId: row.participant_id,
          roleKey: row.role_key,
        }));
      }

      const { rows: participants } = await client.query(
        `SELECT id FROM participants 
         WHERE event_id = $1 AND left_at IS NULL
         ORDER BY created_at ASC`,
        [session.event_id]
      );

      if (participants.length < 2) {
        throw new AppError(`Need at least 2 participants (found ${participants.length})`, 400, 'VALIDATION_FAILED');
      }
      if (participants.length > 6) {
        throw new AppError(`Too many participants (${participants.length}). Maximum is 6 roles available.`, 400, 'VALIDATION_FAILED');
      }

      const roleAssignments = assignRolesToParticipants(participants.map(p => p.id));
      const assignments: Array<{ participantId: string; roleKey: string }> = [];
      const values: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      for (const [participantId, roleKey] of roleAssignments) {
        assignments.push({ participantId, roleKey });
        values.push(`(gen_random_uuid(), $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NULL, NOW())`);
        params.push(sessionId, participantId, roleKey);
      }

      if (values.length > 0) {
        await client.query(
          `INSERT INTO strategic_roles (id, game_session_id, participant_id, role_key, email_sent_at, created_at)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      try {
        await client.query(
          'UPDATE game_sessions SET role_assignment_completed_at = NOW() WHERE id = $1',
          [sessionId]
        );
      } catch {
        // Column might not exist yet
      }

      return assignments;
    });

    return result;
  }

  async getParticipantRole(sessionId: string, participantId: string) {
    const row = await queryOne(
      `SELECT role_key FROM strategic_roles 
       WHERE game_session_id = $1 AND participant_id = $2`,
      [sessionId, participantId]
    );
    return row ? { roleKey: row.role_key } : null;
  }

  async getSessionRoleAssignments(sessionId: string) {
    const rows = await query(
      `SELECT participant_id, role_key FROM strategic_roles 
       WHERE game_session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return rows.map(row => ({
      participantId: row.participant_id,
      roleKey: row.role_key,
    }));
  }

  /**
   * Calculate debrief results: aggregate actions, rank participants, identify most vocal role.
   */
  async getDebriefResults(sessionId: string) {
    try {
      const actions = await query<{
        participant_id: string;
        action_type: string;
        payload: any;
        created_at: string;
      }>(
        `SELECT participant_id, action_type, payload, created_at
         FROM game_actions
         WHERE game_session_id = $1
         ORDER BY created_at ASC`,
        [sessionId]
      );

      const assignments = await query<{
        participant_id: string;
        role_key: string;
      }>(
        `SELECT participant_id, role_key FROM strategic_roles
         WHERE game_session_id = $1`,
        [sessionId]
      );

      const roleByParticipant = new Map(assignments.map(a => [a.participant_id, a.role_key]));
      const scoreByParticipant = new Map<string, number>();
      const actionsByRole = new Map<string, number>();

      for (const action of actions) {
        scoreByParticipant.set(action.participant_id, (scoreByParticipant.get(action.participant_id) || 0) + 1);
        const role = roleByParticipant.get(action.participant_id);
        if (role) {
          actionsByRole.set(role, (actionsByRole.get(role) || 0) + 1);
        }
      }

      const rankings = Array.from(scoreByParticipant.entries())
        .map(([participantId, score]) => ({
          participantId,
          roleKey: roleByParticipant.get(participantId) || 'unknown',
          actionCount: score,
          score,
        }))
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      let mostVocalRole = '';
      let maxActions = 0;
      for (const [role, count] of actionsByRole) {
        if (count > maxActions) {
          maxActions = count;
          mostVocalRole = role;
        }
      }

      return {
        sessionId,
        totalActions: actions.length,
        participantCount: scoreByParticipant.size,
        rankings,
        mostVocalRole,
        actionsByRole: Object.fromEntries(actionsByRole),
        rolesPresent: Array.from(roleByParticipant.values()),
      };
    } catch (error) {
      console.error('[Games.getDebriefResults] Error:', error);
      return {
        sessionId,
        totalActions: 0,
        participantCount: 0,
        rankings: [],
        mostVocalRole: '',
        actionsByRole: {},
        rolesPresent: [],
      };
    }
  }

  /**
   * Transition game to debrief phase with calculated results.
   */
  async startDebrief(sessionId: string) {
    const session = await this.getSession(sessionId);
    const results = await this.getDebriefResults(sessionId);

    const snapshot = await this.getLatestSnapshot(sessionId);
    const state = snapshot?.state ? (typeof snapshot.state === 'string' ? JSON.parse(snapshot.state) : snapshot.state) : {};

    const debriefState = {
      ...state,
      phase: 'debrief',
      debrief_results: results,
      debrief_started_at: new Date().toISOString(),
    };

    await this.saveSnapshot(sessionId, debriefState);
    await query(`UPDATE game_sessions SET debrief_sent_at = NOW() WHERE id = $1`, [sessionId]);

    return {
      sessionId,
      phase: 'debrief',
      results,
      snapshot: debriefState,
    };
  }
}
