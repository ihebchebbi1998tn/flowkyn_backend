/**
 * Parallel Team Mode Service for Strategic Escape (Async Scaling)
 * 
 * Enables 100+ players by splitting into independent teams
 * 20 teams × 5 players = scales perfectly for large groups
 * 
 * How it works:
 * 1. Create game session with team_mode='parallel' and team_size=5
 * 2. createTeams() divides all participants into equal-sized teams
 * 3. Each team gets unique team_id and discussion channel
 * 4. Roles assigned per-team (5 leaders, 5 analysts, etc. per team)
 * 5. All teams solve crisis independently
 * 6. Results aggregated at end for comparison ("How different teams solved it")
 * 
 * Benefits:
 * - Scales from 2 to 100+ players
 * - No role redundancy (each team has full role set)
 * - Better engagement (smaller group dynamics)
 * - Comparable solutions (see different approaches)
 */

import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { v4 as uuid } from 'uuid';

export class ParallelTeamService {
  /**
   * Calculate total teams for a session
   * Example: 100 players with team_size=5 → totalTeams=20
   */
  async calculateTeams(gameSessionId: string, teamSize: number = 5) {
    const participantCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM participants 
       WHERE event_id = (SELECT event_id FROM game_sessions WHERE id = $1)`,
      [gameSessionId]
    );

    if (!participantCount) throw new AppError('No participants found', 400);

    const totalTeams = Math.ceil(participantCount.count / teamSize);

    // Update session with team info
    await query(
      `UPDATE game_sessions 
       SET total_teams = $1, current_team_number = 0, team_size = $2, team_mode = 'parallel'
       WHERE id = $3`,
      [totalTeams, teamSize, gameSessionId]
    );

    return { totalTeams, participantCount: participantCount.count, teamSize };
  }

  /**
   * Create teams and assign participants
   * Evenly distributes participants across teams
   * 
   * Example: 23 players with team_size=5
   * - Team 1: 5 players (team-1)
   * - Team 2: 5 players (team-2)
   * - Team 3: 5 players (team-3)
   * - Team 4: 5 players (team-4)
   * - Team 5: 3 players (team-5)
   * 
   * Each team gets:
   * - Unique team_id (team-1, team-2, etc.)
   * - Dedicated discussion channel reference
   * - Independent crisis scenario
   * - Own role assignments
   */
  async createTeams(gameSessionId: string) {
    return transaction(async (client) => {
      // Get session and participants
      const session = await queryOne<{ event_id: string; team_size: number }>(
        `SELECT event_id, team_size FROM game_sessions WHERE id = $1`,
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

      const teamSize = session.team_size || 5;
      let teamNumber = 1;
      let currentTeamCount = 0;

      // Clear existing teams
      await client.query(
        'DELETE FROM game_teams WHERE game_session_id = $1',
        [gameSessionId]
      );

      // Create team and assign participants
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];

        // Create new team if starting new batch
        if (currentTeamCount === 0) {
          const teamId = `team-${teamNumber}`;
          await client.query(
            `INSERT INTO game_teams 
             (id, game_session_id, team_number, team_id, participant_count, status)
             VALUES ($1, $2, $3, $4, 0, 'active')`,
            [uuid(), gameSessionId, teamNumber, teamId]
          );
        }

        // Assign participant to team
        await client.query(
          `UPDATE strategic_roles 
           SET team_id = $1, team_number = $2
           WHERE game_session_id = $3 AND participant_id = $4`,
          [`team-${teamNumber}`, teamNumber, gameSessionId, p.id]
        );

        // Update team participant count
        await client.query(
          `UPDATE game_teams SET participant_count = participant_count + 1
           WHERE game_session_id = $1 AND team_number = $2`,
          [gameSessionId, teamNumber]
        );

        currentTeamCount++;

        // Move to next team when current is full
        if (currentTeamCount >= teamSize) {
          teamNumber++;
          currentTeamCount = 0;
        }
      }

      return { teamsCreated: teamNumber - 1, totalParticipants: participants.length };
    });
  }

  /**
   * Get all teams for a session with their participants
   */
  async getSessionTeams(gameSessionId: string) {
    return query<{
      id: string;
      team_number: number;
      team_id: string;
      participant_count: number;
      status: string;
    }>(
      `SELECT id, team_number, team_id, participant_count, status
       FROM game_teams
       WHERE game_session_id = $1
       ORDER BY team_number ASC`,
      [gameSessionId]
    );
  }

  /**
   * Get team members with their assigned roles
   */
  async getTeamMembers(gameSessionId: string, teamId: string) {
    return query<{
      participant_id: string;
      role_key: string;
      ready_at: string | null;
    }>(
      `SELECT participant_id, role_key, ready_at
       FROM strategic_roles
       WHERE game_session_id = $1 AND team_id = $2
       ORDER BY created_at ASC`,
      [gameSessionId, teamId]
    );
  }

  /**
   * Get team progress (for status displays)
   * Shows how many teams have completed, are in discussion, etc.
   */
  async getTeamProgress(gameSessionId: string) {
    const result = await queryOne<{
      total_teams: number;
      completed_teams: number;
      active_teams: number;
      total_participants: number;
    }>(
      `SELECT 
        gs.total_teams,
        COUNT(DISTINCT CASE WHEN gt.status = 'completed' THEN gt.id END)::int as completed_teams,
        COUNT(DISTINCT CASE WHEN gt.status = 'active' THEN gt.id END)::int as active_teams,
        COUNT(DISTINCT sr.participant_id)::int as total_participants
       FROM game_sessions gs
       LEFT JOIN game_teams gt ON gt.game_session_id = gs.id
       LEFT JOIN strategic_roles sr ON sr.game_session_id = gs.id
       WHERE gs.id = $1
       GROUP BY gs.id, gs.total_teams`,
      [gameSessionId]
    );

    if (!result) throw new AppError('Session not found', 404);

    return {
      totalTeams: result.total_teams,
      completedTeams: result.completed_teams,
      activeTeams: result.active_teams,
      progress: result.total_teams > 0
        ? Math.round((result.completed_teams / result.total_teams) * 100)
        : 0,
      totalParticipants: result.total_participants,
    };
  }

  /**
   * Mark team as completed
   * Can include final solution/summary
   */
  async completeTeam(
    gameSessionId: string,
    teamId: string,
    finalSolution?: string
  ) {
    await query(
      `UPDATE game_teams 
       SET status = 'completed', final_solution = COALESCE($1, final_solution)
       WHERE game_session_id = $2 AND team_id = $3`,
      [finalSolution || null, gameSessionId, teamId]
    );
  }

  /**
   * Save team results for comparison display
   * Called at end of game to capture each team's approach and effectiveness
   */
  async saveTeamResults(
    gameSessionId: string,
    teamId: string,
    results: {
      solutionSummary: string;
      approach: string;
      effectivenessScore: number;
      creativityScore: number;
      collaborationFeedback?: string;
    }
  ) {
    await query(
      `INSERT INTO game_team_results 
       (id, game_session_id, team_id, solution_summary, approach, 
        effectiveness_score, creativity_score, collaboration_feedback)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (game_session_id, team_id) DO UPDATE SET
         solution_summary = EXCLUDED.solution_summary,
         approach = EXCLUDED.approach,
         effectiveness_score = EXCLUDED.effectiveness_score,
         creativity_score = EXCLUDED.creativity_score,
         collaboration_feedback = EXCLUDED.collaboration_feedback`,
      [
        uuid(),
        gameSessionId,
        teamId,
        results.solutionSummary,
        results.approach,
        results.effectivenessScore,
        results.creativityScore,
        results.collaborationFeedback || null,
      ]
    );
  }

  /**
   * Get all team results for comparison view
   * Used to show "How different teams solved the crisis"
   */
  async getTeamComparison(gameSessionId: string) {
    return query<{
      team_id: string;
      solution_summary: string;
      approach: string;
      effectiveness_score: number;
      creativity_score: number;
      collaboration_feedback: string | null;
    }>(
      `SELECT team_id, solution_summary, approach, effectiveness_score, 
              creativity_score, collaboration_feedback
       FROM game_team_results
       WHERE game_session_id = $1
       ORDER BY effectiveness_score DESC, creativity_score DESC`,
      [gameSessionId]
    );
  }

  /**
   * Check if all teams are ready (all members acknowledged)
   */
  async areAllTeamsReady(gameSessionId: string): Promise<boolean> {
    const result = await queryOne<{ all_ready: boolean }>(
      `SELECT COUNT(DISTINCT sr.participant_id) 
              = COUNT(DISTINCT CASE WHEN sr.ready_at IS NOT NULL THEN sr.participant_id END)
              as all_ready
       FROM strategic_roles sr
       WHERE sr.game_session_id = $1`,
      [gameSessionId]
    );

    return result?.all_ready || false;
  }

  /**
   * Reset teams (useful for multi-round scenarios)
   */
  async resetTeams(gameSessionId: string) {
    return transaction(async (client) => {
      // Reset team statuses
      await client.query(
        `UPDATE game_teams SET status = 'active', final_solution = NULL
         WHERE game_session_id = $1`,
        [gameSessionId]
      );

      // Reset role ready status
      await client.query(
        `UPDATE strategic_roles SET ready_at = NULL, prompt_index = 0
         WHERE game_session_id = $1`,
        [gameSessionId]
      );
    });
  }
}

export const parallelTeamService = new ParallelTeamService();
