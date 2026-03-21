/**
 * Batch Scheduling Service for Two Truths & a Lie (Async Scaling)
 * 
 * Enables 100+ players by scheduling presenters in batches
 * 10 players/batch × 4 rounds = ~40 hours instead of 1,200+ hours
 * 
 * How it works:
 * 1. Create game session with execution_mode='batch' and batch_size=10
 * 2. calculateBatches() distributes participants into batches
 * 3. Each batch gets its own presenter rotation within a round
 * 4. Phase transitions happen on deadline, not real-time sockets
 * 5. All batches run in parallel (async-friendly)
 */

import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { v4 as uuid } from 'uuid';

export class BatchSchedulingService {
  /**
   * Calculate total batches and current batch for a session
   * Example: 100 players with batch_size=10 → totalBatches=10
   */
  async calculateBatches(gameSessionId: string, batchSize: number = 10) {
    const participantCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM participants 
       WHERE event_id = (SELECT event_id FROM game_sessions WHERE id = $1)`,
      [gameSessionId]
    );

    if (!participantCount) throw new AppError('No participants found', 400);

    const totalBatches = Math.ceil(participantCount.count / batchSize);

    // Update session with batch info
    await query(
      `UPDATE game_sessions 
       SET total_batches = $1, current_batch = 0, batch_size = $2
       WHERE id = $3`,
      [totalBatches, batchSize, gameSessionId]
    );

    return { totalBatches, participantCount: participantCount.count, batchSize };
  }

  /**
   * Create batch assignments: divides participants into groups
   * Each batch processes independently with its own presenter order
   * 
   * Example: 25 players with batch_size=10
   * - Batch 1: players 1-10 (presenter order: 0-9)
   * - Batch 2: players 11-20 (presenter order: 0-9)
   * - Batch 3: players 21-25 (presenter order: 0-4)
   */
  async createBatchAssignments(gameSessionId: string) {
    return transaction(async (client) => {
      // Get session and participants
      const session = await queryOne<{ event_id: string; batch_size: number }>(
        `SELECT event_id, batch_size FROM game_sessions WHERE id = $1`,
        [gameSessionId]
      );

      if (!session) throw new AppError('Session not found', 404);

      const participants = await query<{ id: string }>(
        `SELECT id FROM participants 
         WHERE event_id = $1 
         ORDER BY created_at ASC`,
        [session.event_id]
      );

      if (participants.length === 0) throw new AppError('No participants', 400);

      const batchSize = session.batch_size || 10;
      let batchNumber = 1;
      let presenterIndex = 0;

      // Clear existing assignments
      await client.query(
        'DELETE FROM batch_assignments WHERE game_session_id = $1',
        [gameSessionId]
      );

      // Create assignments
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];

        // Reset presenter_index at batch boundary
        if (i > 0 && i % batchSize === 0) {
          batchNumber++;
          presenterIndex = 0;
        }

        await client.query(
          `INSERT INTO batch_assignments 
           (id, game_session_id, batch_number, participant_id, presenter_index, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [uuid(), gameSessionId, batchNumber, p.id, presenterIndex]
        );

        presenterIndex++;
      }

      return { batchesCreated: batchNumber, totalParticipants: participants.length };
    });
  }

  /**
   * Get presenter for current batch and round
   * 
   * Logic:
   * 1. Get current batch number from session
   * 2. Find participant at presenter_index=round_number in that batch
   * 3. Return as current presenter
   * 
   * Example: Batch 2, Round 3 → Get participant at index 3 in batch 2
   */
  async getCurrentBatchPresenter(
    gameSessionId: string,
    roundNumber: number
  ): Promise<string | null> {
    const result = await queryOne<{ participant_id: string }>(
      `SELECT participant_id FROM batch_assignments
       WHERE game_session_id = $1
         AND batch_number = (SELECT current_batch FROM game_sessions WHERE id = $1)
         AND presenter_index = $2
       LIMIT 1`,
      [gameSessionId, roundNumber]
    );

    return result?.participant_id || null;
  }

  /**
   * Move to next batch when current batch completes
   * Updates current_batch counter in session
   */
  async advanceToBatch(gameSessionId: string) {
    const session = await queryOne<{ current_batch: number; total_batches: number }>(
      `SELECT current_batch, total_batches FROM game_sessions WHERE id = $1`,
      [gameSessionId]
    );

    if (!session) throw new AppError('Session not found', 404);

    const nextBatch = session.current_batch + 1;

    if (nextBatch > session.total_batches) {
      throw new AppError('All batches completed', 400);
    }

    await query(
      `UPDATE game_sessions SET current_batch = $1 WHERE id = $2`,
      [nextBatch, gameSessionId]
    );

    return nextBatch;
  }

  /**
   * Get batch progress (useful for status displays)
   */
  async getBatchProgress(gameSessionId: string) {
    const result = await queryOne<{
      current_batch: number;
      total_batches: number;
      batch_size: number;
      participant_count: number;
    }>(
      `SELECT 
        gs.current_batch,
        gs.total_batches,
        gs.batch_size,
        COUNT(DISTINCT ba.participant_id)::int as participant_count
       FROM game_sessions gs
       LEFT JOIN batch_assignments ba ON ba.game_session_id = gs.id
       WHERE gs.id = $1
       GROUP BY gs.id, gs.current_batch, gs.total_batches, gs.batch_size`,
      [gameSessionId]
    );

    if (!result) throw new AppError('Session not found', 404);

    return {
      currentBatch: result.current_batch,
      totalBatches: result.total_batches,
      batchSize: result.batch_size,
      progress: result.total_batches > 0 
        ? Math.round((result.current_batch / result.total_batches) * 100)
        : 0,
      estimatedHours: result.total_batches * 0.5, // ~30 min per batch-round
    };
  }

  /**
   * Get all participants in a specific batch
   */
  async getBatchParticipants(gameSessionId: string, batchNumber: number) {
    return query<{ participant_id: string; presenter_index: number }>(
      `SELECT participant_id, presenter_index FROM batch_assignments
       WHERE game_session_id = $1 AND batch_number = $2
       ORDER BY presenter_index ASC`,
      [gameSessionId, batchNumber]
    );
  }

  /**
   * Create deadline-based batch round
   * Instead of real-time socket transitions, rounds auto-advance after deadline
   */
  async createBatchRound(
    gameSessionId: string,
    roundNumber: number,
    batchNumber: number,
    durationSeconds: number = 1800 // 30 min default
  ) {
    const now = new Date();
    const deadline = new Date(now.getTime() + durationSeconds * 1000);

    const roundId = await queryOne<{ id: string }>(
      `INSERT INTO game_rounds
       (id, game_session_id, round_number, batch_number, is_parallel, 
        round_duration_seconds, round_deadline_at, status, started_at)
       VALUES ($1, $2, $3, $4, true, $5, $6, 'active', NOW())
       RETURNING id`,
      [uuid(), gameSessionId, roundNumber, batchNumber, durationSeconds, deadline]
    );

    return roundId;
  }

  /**
   * Check if deadline has passed and auto-advance phase
   * Used for deadline-based phase transitions (no sockets required)
   */
  async checkAndAdvanceDeadline(gameSessionId: string) {
    const result = await queryOne<{ status: string; round_number: number }>(
      `SELECT gr.status, gr.round_number FROM game_rounds gr
       WHERE gr.game_session_id = $1
         AND gr.status = 'active'
         AND gr.round_deadline_at <= NOW()
       ORDER BY gr.started_at DESC
       LIMIT 1`,
      [gameSessionId]
    );

    if (result) {
      // Auto-advance this round
      await query(
        `UPDATE game_rounds SET status = 'completed', ended_at = NOW()
         WHERE game_session_id = $1 AND round_number = $2`,
        [gameSessionId, result.round_number]
      );

      return { shouldAdvance: true, round: result.round_number };
    }

    return { shouldAdvance: false };
  }
}

export const batchSchedulingService = new BatchSchedulingService();
