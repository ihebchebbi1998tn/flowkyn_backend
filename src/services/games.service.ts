import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { GameSessionRow, GameRoundRow } from '../types';

export class GamesService {
  async listGameTypes() {
    return query('SELECT * FROM game_types ORDER BY name ASC');
  }

  async startSession(eventId: string, gameTypeId: string) {
    // Verify event exists and is active
    const event = await queryOne('SELECT id, status FROM events WHERE id = $1', [eventId]);
    if (!event) throw new AppError('Event not found', 404);
    if (event.status !== 'active') throw new AppError('Event is not active', 400);

    // Verify game type exists
    const gameType = await queryOne('SELECT id FROM game_types WHERE id = $1', [gameTypeId]);
    if (!gameType) throw new AppError('Game type not found', 404);

    const sessionId = uuid();
    const [session] = await query<GameSessionRow>(
      `INSERT INTO game_sessions (id, event_id, game_type_id, status, current_round, game_duration_minutes, started_at)
       VALUES ($1, $2, $3, 'active', 0, 30, NOW()) RETURNING *`,
      [sessionId, eventId, gameTypeId]
    );
    return session;
  }

  async getSession(sessionId: string) {
    const session = await queryOne<GameSessionRow>('SELECT * FROM game_sessions WHERE id = $1', [sessionId]);
    if (!session) throw new AppError('Game session not found', 404);
    return session;
  }

  async startRound(sessionId: string) {
    // Use transaction to prevent race condition on round number
    const round = await transaction(async (client) => {
      // Lock the session row for update
      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404);
      if (session.status !== 'active') throw new AppError('Game session is not active', 400);

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
    // Verify session is active
    const session = await this.getSession(sessionId);
    if (session.status !== 'active') throw new AppError('Game session is not active', 400);

    // Verify round belongs to session and is active
    const round = await queryOne(
      'SELECT id, status FROM game_rounds WHERE id = $1 AND game_session_id = $2',
      [roundId, sessionId]
    );
    if (!round) throw new AppError('Round not found in this session', 404);
    if (round.status !== 'active') throw new AppError('Round is not active', 400);

    const [action] = await query(
      `INSERT INTO game_actions (id, game_session_id, round_id, participant_id, action_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [uuid(), sessionId, roundId, participantId, actionType, JSON.stringify(payload)]
    );
    return action;
  }

  async finishSession(sessionId: string) {
    const results = await transaction(async (client) => {
      // Lock session row
      const { rows: [session] } = await client.query(
        'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404);
      if (session.status === 'finished') throw new AppError('Game session already finished', 400);

      await client.query(
        `UPDATE game_sessions SET status = 'finished', ended_at = NOW() WHERE id = $1`,
        [sessionId]
      );

      // Close any active rounds
      await client.query(
        `UPDATE game_rounds SET status = 'finished', ended_at = NOW()
         WHERE game_session_id = $1 AND status = 'active'`,
        [sessionId]
      );

      // Calculate and BATCH insert results (no N+1)
      const { rows: actions } = await client.query(
        `SELECT participant_id, COUNT(*) as action_count
         FROM game_actions WHERE game_session_id = $1
         GROUP BY participant_id ORDER BY action_count DESC`,
        [sessionId]
      );

      if (actions.length > 0) {
        // Build batch INSERT with VALUES list
        const valueParts: string[] = [];
        const params: any[] = [sessionId];
        let paramIdx = 2;

        for (let i = 0; i < actions.length; i++) {
          const id = uuid();
          valueParts.push(`($${paramIdx++}, $1, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
          params.push(id, actions[i].participant_id, actions.length - i, i + 1);
        }

        await client.query(
          `INSERT INTO game_results (id, game_session_id, participant_id, score, rank, created_at)
           VALUES ${valueParts.map(v => v.replace(')', ', NOW())')).join(', ')}
           ON CONFLICT (game_session_id, participant_id) DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank`,
          params
        );
      }

      return actions;
    });

    return { message: 'Game session finished', results };
  }

  async saveSnapshot(sessionId: string, state: any) {
    const [snapshot] = await query(
      `INSERT INTO game_state_snapshots (id, game_session_id, state, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [uuid(), sessionId, JSON.stringify(state)]
    );
    return snapshot;
  }

  async getPrompts(gameTypeId: string, category?: string) {
    if (category) {
      return query('SELECT * FROM prompts WHERE game_type_id = $1 AND category = $2', [gameTypeId, category]);
    }
    return query('SELECT * FROM prompts WHERE game_type_id = $1', [gameTypeId]);
  }
}
