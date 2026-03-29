/**
 * Core game session operations: CRUD, rounds, actions, snapshots, prompts.
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { GameSessionRow, GameRoundRow } from '../../types';

export class GameSessionCoreService {
  protected clampToEventEnd(candidate: Date | null, eventEnd: string | Date | null | undefined): Date | null {
    if (!candidate) return null;
    if (!eventEnd) return candidate;
    const end = new Date(eventEnd);
    if (!Number.isFinite(end.getTime())) return candidate;
    return candidate.getTime() > end.getTime() ? end : candidate;
  }

  async listGameTypes() {
    return query('SELECT * FROM game_types ORDER BY name ASC');
  }

  async getGameTypeByKey(key: string) {
    return queryOne<{ id: string; key: string }>(
      'SELECT id, key FROM game_types WHERE key = $1',
      [key]
    );
  }

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
    const event = await queryOne<{ id: string; status: string; end_time: string | null }>(
      'SELECT id, status, end_time FROM events WHERE id = $1',
      [eventId],
    );
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

    if (event.status === 'draft') {
      await query('UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2', ['active', eventId]);
      event.status = 'active';
    }

    if (event.status !== 'active') throw new AppError('Cannot start a game — event is not active (current status: ' + event.status + ')', 400, 'SESSION_NOT_ACTIVE');

    const gameType = await queryOne<{ id: string; key: string }>('SELECT id, key FROM game_types WHERE id = $1', [gameTypeId]);
    if (!gameType) throw new AppError('Game type not found', 404, 'NOT_FOUND');

    const result = await transaction(async (client) => {
      await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);

      const { rows: [settings] } = await client.query<{
        max_rounds: number | null;
        default_session_duration_minutes: number | null;
        two_truths_submit_seconds: number | null;
        two_truths_vote_seconds: number | null;
        coffee_chat_duration_minutes: number | null;
        strategic_discussion_duration_minutes: number | null;
      }>(
        `SELECT max_rounds,
                default_session_duration_minutes,
                two_truths_submit_seconds,
                two_truths_vote_seconds,
                coffee_chat_duration_minutes,
                strategic_discussion_duration_minutes
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

      const { rows: [existing] } = await client.query(
        `SELECT gs.id, gs.total_rounds
         FROM game_sessions gs
         WHERE gs.event_id = $1 AND gs.game_type_id = $2 AND gs.status = 'active'`,
         [eventId, gameTypeId]
      );

      if (existing) {
        const { rows: [activeRound] } = await client.query(
           `SELECT id FROM game_rounds WHERE game_session_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
           [existing.id]
        );
        return { session: existing, roundId: activeRound?.id || null, isNew: false };
      }

      const sessionId = uuid();
      let rounds = requestedRounds ?? (Number.isFinite(maxRounds as any) && maxRounds !== null ? Number(maxRounds) : 4);
      if (maxRounds !== null && Number.isFinite(maxRounds)) {
        if (requestedRounds !== null && rounds > maxRounds) {
          throw new AppError(`total_rounds cannot exceed event max_rounds (${maxRounds})`, 400, 'VALIDATION_FAILED');
        }
        rounds = Math.min(rounds, maxRounds);
      }
      const submitSeconds = Math.max(5, Number(settings?.two_truths_submit_seconds ?? 30));
      const voteSeconds = Math.max(5, Number(settings?.two_truths_vote_seconds ?? 20));
      const coffeeMinutes = Math.max(1, Number(settings?.coffee_chat_duration_minutes ?? 30));
      const strategicMinutes = Math.max(1, Number(settings?.strategic_discussion_duration_minutes ?? 45));
      const defaultSessionMinutes = Math.max(1, Number(settings?.default_session_duration_minutes ?? 30));

      const sessionMinutes =
        gameType.key === 'coffee-roulette'
          ? coffeeMinutes
          : gameType.key === 'strategic-escape'
            ? strategicMinutes
            : defaultSessionMinutes;

      const now = new Date();
      const rawSessionDeadline = new Date(now.getTime() + sessionMinutes * 60_000);
      const sessionDeadline = this.clampToEventEnd(rawSessionDeadline, event.end_time);

      const roundSeconds =
        gameType.key === 'two-truths'
          ? Math.max(10, submitSeconds + voteSeconds)
          : 60;
      const rawRoundDeadline = new Date(now.getTime() + roundSeconds * 1000);
      const roundDeadline = this.clampToEventEnd(
        this.clampToEventEnd(rawRoundDeadline, sessionDeadline),
        event.end_time
      );

      const resolvedTiming = {
        gameKey: gameType.key,
        sessionDurationMinutes: sessionMinutes,
        twoTruths: { submitSeconds, voteSeconds },
        coffeeRoulette: { chatDurationMinutes: coffeeMinutes },
        strategicEscape: { discussionDurationMinutes: strategicMinutes },
        roundDurationSeconds: roundSeconds,
        resolvedAt: now.toISOString(),
      };

      const { rows: [session] } = await client.query(
        `INSERT INTO game_sessions (
          id, event_id, game_type_id, status, current_round, game_duration_minutes, total_rounds,
          session_deadline_at, resolved_timing, expires_at, started_at
        )
         VALUES ($1, $2, $3, 'active', 1, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
        [sessionId, eventId, gameTypeId, sessionMinutes, rounds, sessionDeadline, resolvedTiming, sessionDeadline]
      );

      const roundId = uuid();
      await client.query(
        `INSERT INTO game_rounds (id, game_session_id, round_number, round_duration_seconds, round_deadline_at, status, started_at)
         VALUES ($1, $2, 1, $3, $4, 'active', NOW())`,
        [roundId, sessionId, roundSeconds, roundDeadline]
      );

      return { session, roundId, isNew: true };
    });

    if (!result.isNew) {
      const fullExistingSession = await queryOne(
        `SELECT gs.*, gt.key as game_type_key
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         WHERE gs.id = $1`,
        [result.session.id]
      );
      return { ...fullExistingSession, active_round_id: result.roundId } as any;
    }

    // Baseline snapshot for Coffee Roulette
    if (gameType.key === 'coffee-roulette') {
      try {
        await this.saveSnapshot(result.session.id, {
          kind: 'coffee-roulette',
          phase: 'waiting',
          pairs: [],
          startedChatAt: null,
          promptsUsed: 0,
          decisionRequired: false,
          chatDurationMinutes: (result.session as any)?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || 30,
        });
      } catch (err) {
        console.warn('[GamesService] Failed to create initial Coffee Roulette snapshot:', (err as any)?.message || err);
      }
    }

    return { ...result.session, active_round_id: result.roundId, game_type_key: gameType.key } as any;
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
        `SELECT gs.*, e.end_time
         FROM game_sessions gs
         JOIN events e ON e.id = gs.event_id
         WHERE gs.id = $1
         FOR UPDATE`,
        [sessionId]
      );
      if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');
      if (session.status !== 'active') throw new AppError('Game session is not active (current status: ' + session.status + ')', 400, 'SESSION_NOT_ACTIVE');

      const total = Number(session.total_rounds || 0);
      const current = Number(session.current_round || 0);
      if (Number.isFinite(total) && total > 0 && current >= total) {
        throw new AppError('Cannot start a new round — session has reached total_rounds', 400, 'ROUNDS_COMPLETE');
      }

      const hardDeadline = this.clampToEventEnd(session.session_deadline_at ? new Date(session.session_deadline_at) : null, session.end_time);
      if (hardDeadline && hardDeadline.getTime() <= Date.now()) {
        throw new AppError('Cannot start a new round — session deadline has passed', 400, 'SESSION_NOT_ACTIVE');
      }

      const roundNumber = session.current_round + 1;
      const roundId = uuid();
      const resolved = (session.resolved_timing as any) || {};
      const roundSeconds = Number(resolved?.roundDurationSeconds || 60);
      const rawRoundDeadline = new Date(Date.now() + Math.max(5, roundSeconds) * 1000);
      const roundDeadline = this.clampToEventEnd(
        this.clampToEventEnd(rawRoundDeadline, session.session_deadline_at ? new Date(session.session_deadline_at) : null),
        session.end_time
      );

      await client.query('UPDATE game_sessions SET current_round = $1 WHERE id = $2', [roundNumber, sessionId]);
      const { rows: [newRound] } = await client.query(
        `INSERT INTO game_rounds (id, game_session_id, round_number, round_duration_seconds, round_deadline_at, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING *`,
        [roundId, sessionId, roundNumber, Math.max(5, roundSeconds), roundDeadline]
      );
      return newRound;
    });

    return round;
  }

  async submitAction(sessionId: string, roundId: string, participantId: string, actionType: string, payload: any) {
    const session = await this.getSession(sessionId);
    if (session.status !== 'active') throw new AppError('Game session is not active', 400, 'SESSION_NOT_ACTIVE');

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
          rowsToInsert = Object.entries(customScores)
            .map(([pid, sc]) => ({ participantId: pid, score: sc }))
            .sort((a, b) => b.score - a.score);

          const matchedIds = new Set(rowsToInsert.map(r => r.participantId));
          for (const action of actions) {
            if (!matchedIds.has(action.participant_id)) {
              rowsToInsert.push({ participantId: action.participant_id, score: 0 });
            }
          }
        } else {
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
      // Non-fatal
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

  async getPrompts(gameTypeId: string, category?: string) {
    if (category) {
      return query('SELECT * FROM prompts WHERE game_type_id = $1 AND category = $2', [gameTypeId, category]);
    }
    return query('SELECT * FROM prompts WHERE game_type_id = $1', [gameTypeId]);
  }
}
