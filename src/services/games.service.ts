import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { GameSessionRow, GameRoundRow } from '../types';

export class GamesService {
  async listGameTypes() {
    return query('SELECT * FROM game_types ORDER BY name ASC');
  }

  /** Helper to resolve a game type row by key. */
  async getGameTypeByKey(key: string) {
    return queryOne<{ id: string; key: string }>(
      'SELECT id, key FROM game_types WHERE key = $1',
      [key]
    );
  }

  /**
   * Find the most recent active game session for a given event, regardless of game type.
   */
  async getLatestActiveSessionForEvent(eventId: string) {
    const session = await queryOne<GameSessionRow & { game_key: string }>(
      `SELECT gs.*, gt.key as game_key
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       WHERE gs.event_id = $1
         AND gs.status = 'active'
       ORDER BY gs.started_at DESC
       LIMIT 1`,
      [eventId]
    );
    return session || null;
  }

  /**
   * Find the most recent active game session for a given event + game type key.
   * Returns null if no active session exists.
   */
  async getActiveSessionByEventAndKey(eventId: string, gameKey: string) {
    const session = await queryOne<GameSessionRow>(
      `SELECT gs.*
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       WHERE gs.event_id = $1
         AND gt.key = $2
         AND gs.status = 'active'
       ORDER BY gs.started_at DESC
       LIMIT 1`,
      [eventId, gameKey]
    );
    return session || null;
  }

  async startSession(eventId: string, gameTypeId: string, totalRounds?: number) {
    const event = await queryOne('SELECT id, status FROM events WHERE id = $1', [eventId]);
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
    
    // Auto-activate event if it's in draft status
    if (event.status === 'draft') {
      await query('UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2', ['active', eventId]);
      event.status = 'active';
    }

    if (event.status !== 'active') throw new AppError('Cannot start a game — event is not active (current status: ' + event.status + ')', 400, 'SESSION_NOT_ACTIVE');

    const gameType = await queryOne('SELECT id FROM game_types WHERE id = $1', [gameTypeId]);
    if (!gameType) throw new AppError('Game type not found', 404, 'NOT_FOUND');

    const result = await transaction(async (client) => {
      // Lock the event row to serialize session creation for this event
      await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);

      // Validate totalRounds and enforce event_settings.max_rounds (if present)
      const { rows: [settings] } = await client.query<{ max_rounds: number | null }>(
        `SELECT max_rounds
         FROM event_settings
         WHERE event_id = $1`,
        [eventId]
      );

      const maxRounds = settings?.max_rounds ?? null;

      let requestedRounds: number | null = null;
      if (totalRounds !== undefined && totalRounds !== null) {
        const n = Number(totalRounds);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
          throw new AppError('total_rounds must be a positive integer', 400, 'VALIDATION_FAILED');
        }
        requestedRounds = n;
      }

      // Concurrency check: prevent multiple active sessions for the same game
      const { rows: [existing] } = await client.query(
        `SELECT gs.id, gs.total_rounds
         FROM game_sessions gs
         WHERE gs.event_id = $1 AND gs.game_type_id = $2 AND gs.status = 'active'`,
         [eventId, gameTypeId]
      );

      if (existing) {
        // Return existing session ID and fetch its active round
        const { rows: [activeRound] } = await client.query(
           `SELECT id FROM game_rounds WHERE game_session_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
           [existing.id]
        );
        return { session: existing, roundId: activeRound?.id || null, isNew: false };
      }

      const sessionId = uuid();
      let rounds = requestedRounds ?? (Number.isFinite(maxRounds as any) && maxRounds !== null ? Number(maxRounds) : 4);
      if (maxRounds !== null && Number.isFinite(maxRounds)) {
        // If an event-wide cap exists, clamp the default and reject explicit overflow
        if (requestedRounds !== null && rounds > maxRounds) {
          throw new AppError(`total_rounds cannot exceed event max_rounds (${maxRounds})`, 400, 'VALIDATION_FAILED');
        }
        rounds = Math.min(rounds, maxRounds);
      }
      // Create the session and an initial active round so clients can immediately
      // submit actions without needing an admin-only "start round" step.
      const { rows: [session] } = await client.query(
        `INSERT INTO game_sessions (id, event_id, game_type_id, status, current_round, game_duration_minutes, total_rounds, started_at)
         VALUES ($1, $2, $3, 'active', 1, 30, $4, NOW()) RETURNING *`,
        [sessionId, eventId, gameTypeId, rounds]
      );

      const roundId = uuid();
      await client.query(
        `INSERT INTO game_rounds (id, game_session_id, round_number, round_duration_seconds, status, started_at)
         VALUES ($1, $2, 1, 60, 'active', NOW())`,
        [roundId, sessionId]
      );

      return { session, roundId, isNew: true };
    });

    if (!result.isNew) {
      // Just fetch the full existing session to return it
      const fullExistingSession = await queryOne('SELECT * FROM game_sessions WHERE id = $1', [result.session.id]);
      return { ...fullExistingSession, active_round_id: result.roundId } as any;
    }

    // Include roundId for convenience to callers that need it.
    return { ...result.session, active_round_id: result.roundId } as any;
  }

  async getSession(sessionId: string) {
    const session = await queryOne<GameSessionRow>('SELECT * FROM game_sessions WHERE id = $1', [sessionId]);
    if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');
    return session;
  }

  async getActiveRound(sessionId: string) {
    const round = await queryOne<GameRoundRow>(
      `SELECT * FROM game_rounds
       WHERE game_session_id = $1 AND status = 'active'
       ORDER BY started_at DESC
       LIMIT 1`,
      [sessionId]
    );
    return round || null;
  }

  async getLatestSnapshot(sessionId: string) {
    const snapshot = await queryOne<{ id: string; game_session_id: string; state: any; created_at: Date }>(
      `SELECT * FROM game_state_snapshots
       WHERE game_session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );
    return snapshot || null;
  }

  async getSessionActions(sessionId: string, limit = 100, offset = 0) {
    return query(
      `SELECT ga.*, 
              COALESCE(u.name, p.guest_name, 'Unknown') as participant_name
       FROM game_actions ga
       JOIN participants p ON p.id = ga.participant_id
       LEFT JOIN organization_members om ON om.id = p.organization_member_id
       LEFT JOIN users u ON u.id = om.user_id
       WHERE ga.game_session_id = $1
       ORDER BY ga.created_at ASC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset]
    );
  }

  async getSessionSnapshots(sessionId: string, limit = 100, offset = 0) {
    return query(
      `SELECT * FROM game_state_snapshots
       WHERE game_session_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset]
    );
  }

  async startRound(sessionId: string) {
    const round = await transaction(async (client) => {
      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');
      if (session.status !== 'active') throw new AppError('Game session is not active (current status: ' + session.status + ')', 400, 'SESSION_NOT_ACTIVE');

      const total = Number(session.total_rounds || 0);
      const current = Number(session.current_round || 0);
      if (Number.isFinite(total) && total > 0 && current >= total) {
        throw new AppError('Cannot start a new round — session has reached total_rounds', 400, 'ROUNDS_COMPLETE');
      }

      const roundNumber = session.current_round + 1;
      const roundId = uuid();

      await client.query('UPDATE game_sessions SET current_round = $1 WHERE id = $2', [roundNumber, sessionId]);
      const { rows: [newRound] } = await client.query(
        `INSERT INTO game_rounds (id, game_session_id, round_number, round_duration_seconds, status, started_at)
         VALUES ($1, $2, $3, 60, 'active', NOW()) RETURNING *`,
        [roundId, sessionId, roundNumber]
      );
      return newRound;
    });

    return round;
  }

  async submitAction(sessionId: string, roundId: string, participantId: string, actionType: string, payload: any) {
    const session = await this.getSession(sessionId);
    if (session.status !== 'active') throw new AppError('Game session is not active', 400, 'SESSION_NOT_ACTIVE');

    // Use transaction to prevent concurrent round-end race conditions
    const action = await transaction(async (client) => {
      const { rows: [round] } = await client.query(
        'SELECT id, status FROM game_rounds WHERE id = $1 AND game_session_id = $2 FOR UPDATE',
        [roundId, sessionId]
      );
      if (!round) throw new AppError('Round not found in this session', 404, 'NOT_FOUND');
      if (round.status !== 'active') throw new AppError('This round is no longer active', 400, 'ROUND_NOT_ACTIVE');

      const { rows: [validParticipant] } = await client.query(
        `SELECT p.id FROM participants p
         WHERE p.id = $1 AND p.event_id = $2 AND p.left_at IS NULL`,
        [participantId, session.event_id]
      );
      if (!validParticipant) throw new AppError('Participant not found in this game session', 403, 'NOT_PARTICIPANT');

      const { rows: [newAction] } = await client.query(
        `INSERT INTO game_actions (id, game_session_id, round_id, participant_id, action_type, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
        [uuid(), sessionId, roundId, participantId, actionType, payload]
      );
      return newAction;
    });
    
    return action;
  }

  async finishSession(sessionId: string, customScores?: Record<string, number>) {
    const results = await transaction(async (client) => {
      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');
      if (session.status === 'finished') throw new AppError('Game session is already finished', 400, 'SESSION_ALREADY_FINISHED');

      await client.query(
        `UPDATE game_sessions SET status = 'finished', ended_at = NOW() WHERE id = $1`,
        [sessionId]
      );

      await client.query(
        `UPDATE game_rounds SET status = 'finished', ended_at = NOW()
         WHERE game_session_id = $1 AND status = 'active'`,
        [sessionId]
      );

      const { rows: actions } = await client.query(
        `SELECT participant_id, COUNT(*) as action_count
         FROM game_actions WHERE game_session_id = $1
         GROUP BY participant_id ORDER BY action_count DESC`,
        [sessionId]
      );

      if (actions.length > 0) {
        let rowsToInsert: Array<{ participantId: string; score: number }> = [];

        if (customScores) {
          // Flatten custom scores into an array, sorted by score descending
          rowsToInsert = Object.entries(customScores)
            .map(([pid, sc]) => ({ participantId: pid, score: sc }))
            .sort((a, b) => b.score - a.score);
            
          // Include participants who might have 0 score but had actions
          const matchedIds = new Set(rowsToInsert.map(r => r.participantId));
          for (const action of actions) {
            if (!matchedIds.has(action.participant_id)) {
              rowsToInsert.push({ participantId: action.participant_id, score: 0 });
            }
          }
        } else {
          // Default: rank by number of actions
          rowsToInsert = actions.map(a => ({
            participantId: a.participant_id,
            score: Number(a.action_count)
          }));
        }

        if (rowsToInsert.length > 0) {
          const valueParts: string[] = [];
          const params: any[] = [];
          let paramIdx = 1;

          for (let i = 0; i < rowsToInsert.length; i++) {
            const rowId = uuid();
            const score = rowsToInsert[i].score;
            // Rank logic (handle ties if we want, but simple index based works for now)
            const rank = i + 1;
            valueParts.push(
              `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NOW())`
            );
            params.push(rowId, sessionId, rowsToInsert[i].participantId, score, rank);
          }

          await client.query(
            `INSERT INTO game_results (id, game_session_id, participant_id, score, rank, created_at)
             VALUES ${valueParts.join(', ')}
             ON CONFLICT (game_session_id, participant_id) DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank`,
            params
          );
        }
      }

      return actions;
    });

    // Provide a clearer message for Coffee Roulette which is not score-based.
    // Keep the response shape stable for existing clients.
    let message = 'Game session finished';
    try {
      const row = await queryOne<{ key: string }>(
        `SELECT gt.key
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         WHERE gs.id = $1`,
        [sessionId]
      );
      if (row?.key === 'coffee-roulette') {
        message = 'Coffee Roulette session finished';
      }
    } catch {
      // Non-fatal; keep generic message
    }

    return { message, results };
  }

  async saveSnapshot(sessionId: string, state: any) {
    const [snapshot] = await query(
      `INSERT INTO game_state_snapshots (id, game_session_id, state, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [uuid(), sessionId, state]
    );
    return snapshot;
  }

  /**
   * Create a Strategic Escape session for an event with initial configuration snapshot.
   *
   * NOTE: To keep analytics and translations stable over time, we store BOTH
   * stable keys (industryKey/crisisKey/difficultyKey) and human-readable labels.
   * Existing callers that only send labels remain supported.
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
    }
  ) {
    const gameType = await this.getGameTypeByKey('strategic-escape');
    if (!gameType) throw new AppError('Strategic Escape game type not found', 404, 'NOT_FOUND');

    const session = await this.startSession(eventId, gameType.id);

    const initialState = {
      kind: 'strategic-escape',
      phase: 'setup',
      // Stable keys for analytics and future filtering
      industryKey: config.industryKey || null,
      crisisKey: config.crisisKey || null,
      difficultyKey: config.difficulty,
      // Human-readable labels for immediate display / email content
      industryLabel: config.industry,
      crisisLabel: config.crisisType,
      difficultyLabel: config.difficultyLabel || config.difficulty,
      rolesAssigned: false,
    };

    await this.saveSnapshot(session.id, initialState);
    return session;
  }

  /**
   * Assign strategic roles to all active participants for the session's event.
   * CRITICAL FIXES:
   * - Uses SERIALIZABLE isolation level to prevent race conditions
   * - Handles concurrent requests gracefully (returns existing assignments)
   * - Uses the existing 'strategic_roles' table from migration 20260315
   */
  async assignStrategicRoles(sessionId: string) {
    const { getRoleKeys, assignRolesToParticipants } = await import('./roleDefinitions');

    const result = await transaction(async (client) => {
      // Set SERIALIZABLE isolation level to prevent race conditions
      // This ensures that if two requests try to assign simultaneously,
      // only one will succeed and the other will get a serialization error
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      // Fetch session with lock
      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );

      if (!session) {
        throw new AppError('Game session not found', 404, 'NOT_FOUND');
      }

      if (session.status !== 'active') {
        throw new AppError('Session is not active', 400, 'SESSION_NOT_ACTIVE');
      }

      // Check if roles already assigned (idempotency - return existing)
      const { rows: existing } = await client.query(
        `SELECT participant_id, role_key FROM strategic_roles WHERE game_session_id = $1`,
        [sessionId]
      );

      if (existing.length > 0) {
        // Roles already assigned - return existing assignments
        return existing.map((row: any) => ({
          participantId: row.participant_id,
          roleKey: row.role_key,
        }));
      }

      // Fetch all active participants
      const { rows: participants } = await client.query(
        `SELECT id FROM participants 
         WHERE event_id = $1 AND left_at IS NULL
         ORDER BY created_at ASC`,
        [session.event_id]
      );

      if (participants.length < 2) {
        throw new AppError(
          `Need at least 2 participants (found ${participants.length})`,
          400,
          'VALIDATION_FAILED'
        );
      }

      if (participants.length > 6) {
        throw new AppError(
          `Too many participants (${participants.length}). Maximum is 6 roles available.`,
          400,
          'VALIDATION_FAILED'
        );
      }

      // Assign roles using the function from roleDefinitions
      const roleAssignments = assignRolesToParticipants(participants.map(p => p.id));
      const assignments: Array<{ participantId: string; roleKey: string }> = [];

      // Prepare batch insert for strategic_roles table
      const values: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      for (const [participantId, roleKey] of roleAssignments) {
        assignments.push({ participantId, roleKey });
        values.push(`(uuid_generate_v4(), $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NULL, NOW())`);
        params.push(sessionId, participantId, roleKey);
      }

      // Persist to database using existing strategic_roles table
      if (values.length > 0) {
        await client.query(
          `INSERT INTO strategic_roles (id, game_session_id, participant_id, role_key, email_sent_at, created_at)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      // Update session to mark roles assigned (if column exists)
      try {
        await client.query(
          'UPDATE game_sessions SET role_assignment_completed_at = NOW() WHERE id = $1',
          [sessionId]
        );
      } catch (e) {
        // Column might not exist yet, that's ok - optional metadata
      }

      return assignments;
    });

    return result;
  }

  /**
   * CRITICAL: Get a participant's assigned role
   */
  async getParticipantRole(sessionId: string, participantId: string) {
    const row = await queryOne(
      `SELECT role_key FROM strategic_roles 
       WHERE game_session_id = $1 AND participant_id = $2`,
      [sessionId, participantId]
    );

    if (!row) return null;

    return {
      roleKey: row.role_key,
    };
  }

  /**
   * Get all role assignments for a game session
   */
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
   * CRITICAL: Calculate and return debrief results for a Strategic Escape session
   * Aggregates votes, calculates role performance, and returns insights
   */
  async getDebriefResults(sessionId: string) {
    try {
      // Fetch all actions for this session
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

      // Get role assignments
      const assignments = await query<{
        participant_id: string;
        role_key: string;
      }>(
        `SELECT participant_id, role_key FROM strategic_roles
         WHERE game_session_id = $1`,
        [sessionId]
      );

      const roleByParticipant = new Map(assignments.map(a => [a.participant_id, a.role_key]));

      // Count actions by participant (basic scoring)
      const scoreByParticipant = new Map<string, number>();
      const actionsByRole = new Map<string, number>();

      for (const action of actions) {
        const current = scoreByParticipant.get(action.participant_id) || 0;
        scoreByParticipant.set(action.participant_id, current + 1);

        const role = roleByParticipant.get(action.participant_id);
        if (role) {
          const roleCount = actionsByRole.get(role) || 0;
          actionsByRole.set(role, roleCount + 1);
        }
      }

      // Rank participants by action count
      const rankings = Array.from(scoreByParticipant.entries())
        .map(([participantId, score]) => ({
          participantId,
          roleKey: roleByParticipant.get(participantId) || 'unknown',
          actionCount: score,
          score, // For compatibility
        }))
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({
          ...entry,
          rank: index + 1,
        }));

      // Identify most vocal role
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
        rankings, // Sorted by score descending
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
   * CRITICAL: Start the debrief phase and calculate final results
   * This transitions the game from discussion to debrief phase
   */
  async startDebrief(sessionId: string) {
    const session = await this.getSession(sessionId);

    // Get debrief results
    const results = await this.getDebriefResults(sessionId);

    // Get latest snapshot to update it
    const snapshot = await this.getLatestSnapshot(sessionId);
    const state = snapshot?.state ? (typeof snapshot.state === 'string' ? JSON.parse(snapshot.state) : snapshot.state) : {};

    // Update snapshot with debrief data
    const debriefState = {
      ...state,
      phase: 'debrief',
      debrief_results: results,
      debrief_started_at: new Date().toISOString(),
    };

    // Save new debrief snapshot
    await this.saveSnapshot(sessionId, debriefState);

    // Update session metadata
    await query(
      `UPDATE game_sessions SET debrief_sent_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    return {
      sessionId,
      phase: 'debrief',
      results,
      snapshot: debriefState,
    };
  }

  async getPrompts(gameTypeId: string, category?: string) {
    if (category) {
      return query('SELECT * FROM prompts WHERE game_type_id = $1 AND category = $2', [gameTypeId, category]);
    }
    return query('SELECT * FROM prompts WHERE game_type_id = $1', [gameTypeId]);
  }
}
