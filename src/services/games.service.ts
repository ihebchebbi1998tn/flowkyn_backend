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

  async startSession(eventId: string, gameTypeId: string) {
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

      // Concurrency check: prevent multiple active sessions for the same game
      const { rows: [existing] } = await client.query(
        `SELECT gs.id
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
      // Create the session and an initial active round so clients can immediately
      // submit actions without needing an admin-only "start round" step.
      const { rows: [session] } = await client.query(
        `INSERT INTO game_sessions (id, event_id, game_type_id, status, current_round, game_duration_minutes, started_at)
         VALUES ($1, $2, $3, 'active', 1, 30, NOW()) RETURNING *`,
        [sessionId, eventId, gameTypeId]
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

    return { message: 'Game session finished', results };
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
   */
  async createStrategicSession(eventId: string, config: {
    industry: string;
    crisisType: string;
    difficulty: string;
  }) {
    const gameType = await this.getGameTypeByKey('strategic-escape');
    if (!gameType) throw new AppError('Strategic Escape game type not found', 404, 'NOT_FOUND');

    const session = await this.startSession(eventId, gameType.id);

    const initialState = {
      kind: 'strategic-escape',
      phase: 'setup',
      industry: config.industry,
      crisisType: config.crisisType,
      difficulty: config.difficulty,
      rolesAssigned: false,
    };

    await this.saveSnapshot(session.id, initialState);
    return session;
  }

  /**
   * Assign strategic roles to all active participants for the session's event.
   * Inserts rows into strategic_roles and returns mapping of participant_id -> role_key.
   */
  async assignStrategicRoles(sessionId: string) {
    // Simple fixed catalog of roles; frontend will localize labels by role_key.
    const ROLE_KEYS = ['product_lead', 'marketing_lead', 'cfo', 'ops_lead', 'customer_success_lead'] as const;

    const session = await this.getSession(sessionId);

    // Fetch all active participants for this event
    const participants = await query<{ id: string; organization_member_id: string | null }>(
      `SELECT id, organization_member_id
       FROM participants
       WHERE event_id = $1 AND left_at IS NULL
       ORDER BY created_at ASC`,
      [session.event_id]
    );

    if (participants.length === 0) {
      throw new AppError('No active participants found for this event', 400, 'NOT_PARTICIPANT');
    }

    // Fetch any existing strategic_roles so we don't duplicate
    const existing = await query<{ participant_id: string }>(
      `SELECT participant_id
       FROM strategic_roles
       WHERE game_session_id = $1`,
      [sessionId]
    );
    const existingIds = new Set(existing.map(r => r.participant_id));

    // Deterministic role assignment: cycle through ROLE_KEYS
    const assignments: { participantId: string; roleKey: string }[] = [];
    let roleIndex = 0;
    for (const p of participants) {
      if (existingIds.has(p.id)) continue;
      const roleKey = ROLE_KEYS[roleIndex % ROLE_KEYS.length];
      assignments.push({ participantId: p.id, roleKey });
      roleIndex += 1;
    }

    if (assignments.length === 0) {
      // Nothing new to assign; simply return
      return [];
    }

    // Insert new strategic_roles rows
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const a of assignments) {
      values.push(`(uuid_generate_v4(), $${idx++}, $${idx++}, $${idx++}, NULL, NOW())`);
      params.push(sessionId, a.participantId, a.roleKey);
    }
    await query(
      `INSERT INTO strategic_roles (id, game_session_id, participant_id, role_key, email_sent_at, created_at)
       VALUES ${values.join(', ')}`,
      params
    );

    return assignments;
  }

  async getPrompts(gameTypeId: string, category?: string) {
    if (category) {
      return query('SELECT * FROM prompts WHERE game_type_id = $1 AND category = $2', [gameTypeId, category]);
    }
    return query('SELECT * FROM prompts WHERE game_type_id = $1', [gameTypeId]);
  }
}
