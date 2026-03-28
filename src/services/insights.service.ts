import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface PlayerInsights {
  id: string;
  game_session_id: string;
  participant_id: string;
  game_type: string;
  total_guesses: number;
  correct_guesses: number;
  accuracy_percentage: number;
  best_guess_round: number | null;
  best_guess_statement: string | null;
  best_guess_accuracy_percentage: number | null;
  trickiest_statement_text: string | null;
  trickiest_statement_fool_percentage: number | null;
  previous_accuracy_percentage: number | null;
  percentile_rank: number | null;
  total_players_compared: number | null;
  calculated_at: Date;
  created_at: Date;
  updated_at: Date;
}

export class InsightsService {
  /**
   * Calculate and store insights for a Two Truths player
   */
  async calculateTwoTruthsInsights(
    sessionId: string,
    participantId: string,
  ): Promise<PlayerInsights> {
    // Get all votes for this participant in this session
    const votes = await query<{
      round_id: string;
      round_number: number;
      participant_id: string;
      action_type: string;
      payload: string;
    }>(
      `SELECT ga.round_id, gr.round_number, ga.participant_id, ga.action_type, ga.payload
       FROM game_actions ga
       JOIN game_rounds gr ON gr.id = ga.round_id
       WHERE ga.game_session_id = $1 
         AND ga.participant_id = $2
         AND ga.action_type = 'vote'`,
      [sessionId, participantId]
    );

    // Get game session and statements
    const session = await queryOne<{
      game_session_id: string;
      total_rounds: number;
    }>(
      'SELECT id as game_session_id, total_rounds FROM game_sessions WHERE id = $1',
      [sessionId]
    );

    if (!session) throw new AppError('Game session not found', 404, 'NOT_FOUND');

    // Calculate accuracy
    const totalGuesses = votes.length;
    let correctGuesses = 0;
    let bestGuessRound = null;
    let bestGuessStatement = null;
    let bestGuessAccuracy = 0;
    let trickiestStatement = null;
    let trickiestStatementFoolPercentage = 0;

    // Process each vote
    for (const vote of votes) {
      const payload = typeof vote.payload === 'string' ? JSON.parse(vote.payload) : vote.payload;
      
      // Check if vote was correct (would need to compare with actual correct answer)
      // This is a simplified version - in production, you'd fetch the actual correct answer
      const isCorrect = payload.correct === true;
      if (isCorrect) {
        correctGuesses++;
      }

      // Track best guess (highest accuracy round)
      if (isCorrect && (!bestGuessRound || vote.round_number > bestGuessRound)) {
        bestGuessRound = vote.round_number;
        bestGuessAccuracy = 100;
      }
    }

    const accuracyPercentage = totalGuesses > 0 ? (correctGuesses / totalGuesses) * 100 : 0;

    // Get previous insights for comparison
    const previousInsights = await queryOne<{
      accuracy_percentage: number;
    }>(
      `SELECT accuracy_percentage FROM player_insights 
       WHERE participant_id = $1 AND game_type = 'two_truths' 
       ORDER BY created_at DESC LIMIT 1`,
      [participantId]
    );

    // Calculate percentile rank (simplified - would need aggregation in production)
    const allSessionInsights = await query<{
      participant_id: string;
      accuracy_percentage: number;
    }>(
      `SELECT DISTINCT ON (participant_id) participant_id, accuracy_percentage 
       FROM player_insights 
       WHERE game_type = 'two_truths' 
       ORDER BY participant_id, created_at DESC`
    );

    const playersWithHigherAccuracy = allSessionInsights.filter(
      p => p.accuracy_percentage > accuracyPercentage
    ).length;
    const percentileRank = allSessionInsights.length > 0 
      ? ((allSessionInsights.length - playersWithHigherAccuracy) / allSessionInsights.length) * 100
      : 0;

    // Store insights
    const insightId = uuid();
    const [insight] = await query<PlayerInsights>(
      `INSERT INTO player_insights (
        id, game_session_id, participant_id, game_type,
        total_guesses, correct_guesses, accuracy_percentage,
        best_guess_round, best_guess_statement, best_guess_accuracy_percentage,
        trickiest_statement_text, trickiest_statement_fool_percentage,
        previous_accuracy_percentage, percentile_rank, total_players_compared,
        calculated_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW())
       RETURNING *`,
      [
        insightId,
        sessionId,
        participantId,
        'two_truths',
        totalGuesses,
        correctGuesses,
        accuracyPercentage,
        bestGuessRound,
        bestGuessStatement,
        bestGuessAccuracy,
        trickiestStatement,
        trickiestStatementFoolPercentage,
        previousInsights?.accuracy_percentage || null,
        percentileRank,
        allSessionInsights.length,
      ]
    );

    return insight;
  }

  /**
   * Get insights for a player in a session
   */
  async getInsights(sessionId: string, participantId: string): Promise<PlayerInsights | null> {
    return queryOne<PlayerInsights>(
      `SELECT * FROM player_insights 
       WHERE game_session_id = $1 AND participant_id = $2`,
      [sessionId, participantId]
    );
  }

  /**
   * Get all insights for a session
   */
  async getSessionInsights(sessionId: string): Promise<PlayerInsights[]> {
    return query<PlayerInsights>(
      `SELECT * FROM player_insights 
       WHERE game_session_id = $1 
       ORDER BY accuracy_percentage DESC`,
      [sessionId]
    );
  }

  /**
   * Get player's insight history for comparison
   */
  async getPlayerInsightHistory(
    participantId: string,
    gameType: string,
    limit: number = 10
  ): Promise<PlayerInsights[]> {
    return query<PlayerInsights>(
      `SELECT * FROM player_insights 
       WHERE participant_id = $1 AND game_type = $2 
       ORDER BY created_at DESC 
       LIMIT $3`,
      [participantId, gameType, limit]
    );
  }
}
