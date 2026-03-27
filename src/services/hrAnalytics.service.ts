/**
 * @fileoverview HR Analytics Service
 *
 * Aggregates game-specific data into HR-actionable insights:
 * - Coffee Roulette → connection density, pairing frequency
 * - Wins of the Week → sentiment, engagement, participation
 * - Strategic Escape → collaboration quality, completion rates
 */

import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export class HRAnalyticsService {
  /**
   * Verify user has access to the organization.
   */
  private async verifyAccess(userId: string, organizationId: string) {
    const access = await queryOne(
      `SELECT om.id FROM organization_members om
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, organizationId]
    );
    if (!access) throw new AppError('Access denied', 403, 'FORBIDDEN');
  }

  /**
   * Full HR analytics dashboard for an organization.
   */
  async getDashboard(userId: string, organizationId: string) {
    await this.verifyAccess(userId, organizationId);

    const [
      overview,
      gameInsights,
      connectionInsights,
      sentimentInsights,
      collaborationInsights,
      participationTrend,
    ] = await Promise.all([
      this.getOverview(organizationId),
      this.getGameInsights(organizationId),
      this.getConnectionInsights(organizationId),
      this.getSentimentInsights(organizationId),
      this.getCollaborationInsights(organizationId),
      this.getParticipationTrend(organizationId),
    ]);

    return {
      overview,
      gameInsights,
      connectionInsights,
      sentimentInsights,
      collaborationInsights,
      participationTrend,
    };
  }

  private async getOverview(orgId: string) {
    const [stats] = await query<any>(
      `SELECT
         COUNT(DISTINCT gs.id) FILTER (WHERE gs.status = 'active') as active_sessions,
         COUNT(DISTINCT p.id) FILTER (WHERE p.created_at > NOW() - INTERVAL '30 days') as participants_this_month,
         COUNT(DISTINCT gs.id) as total_sessions,
         COUNT(DISTINCT gs.id) FILTER (WHERE gs.status = 'finished') as finished_sessions,
         COUNT(DISTINCT p.id) FILTER (WHERE p.created_at > NOW() - INTERVAL '60 days' AND p.created_at <= NOW() - INTERVAL '30 days') as prev_month_participants
       FROM events e
       LEFT JOIN game_sessions gs ON gs.event_id = e.id
       LEFT JOIN participants p ON p.event_id = e.id
       WHERE e.organization_id = $1`,
      [orgId]
    );

    const totalSessions = parseInt(stats?.total_sessions || '0');
    const finishedSessions = parseInt(stats?.finished_sessions || '0');
    const participantsThisMonth = parseInt(stats?.participants_this_month || '0');
    const prevMonthParticipants = parseInt(stats?.prev_month_participants || '0');

    const completionRate = totalSessions > 0 ? (finishedSessions / totalSessions) * 100 : 0;
    const engagementScore = Math.min(100, Math.round(completionRate * 0.6 + Math.min(participantsThisMonth, 50) * 0.8));
    const growth = prevMonthParticipants > 0
      ? ((participantsThisMonth - prevMonthParticipants) / prevMonthParticipants) * 100
      : participantsThisMonth > 0 ? 100 : 0;

    return {
      totalActiveSessions: parseInt(stats?.active_sessions || '0'),
      totalParticipantsThisMonth: participantsThisMonth,
      engagementScore,
      monthOverMonthGrowth: Math.round(growth * 10) / 10,
    };
  }

  private async getGameInsights(orgId: string) {
    return query<any>(
      `SELECT
         gt.key as game_key, gt.name as game_name,
         COUNT(DISTINCT gs.id) as total_sessions,
         COUNT(DISTINCT p.id) as total_participants,
         ROUND(
           COUNT(CASE WHEN gs.status = 'finished' THEN 1 END)::NUMERIC /
           NULLIF(COUNT(gs.id), 0) * 100, 1
         ) as avg_completion_rate,
         ROUND(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at)) / 60.0)::NUMERIC, 1) as avg_duration_minutes
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       JOIN events e ON e.id = gs.event_id
       LEFT JOIN participants p ON p.event_id = e.id
       WHERE e.organization_id = $1
       GROUP BY gt.key, gt.name
       ORDER BY total_sessions DESC`,
      [orgId]
    );
  }

  private async getConnectionInsights(orgId: string) {
    // Coffee Roulette specific metrics from game_actions
    const [pairingStats] = await query<any>(
      `SELECT
         COUNT(DISTINCT ga.id) FILTER (WHERE ga.action_type IN ('pair_formed', 'shuffle')) as total_pairings,
         COUNT(DISTINCT ga.participant_id) as unique_participants
       FROM game_actions ga
       JOIN game_sessions gs ON gs.id = ga.game_session_id
       JOIN game_types gt ON gt.id = gs.game_type_id
       JOIN events e ON e.id = gs.event_id
       WHERE e.organization_id = $1 AND gt.key = 'coffee-roulette'`,
      [orgId]
    );

    const [durationStats] = await query<any>(
      `SELECT
         ROUND(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at)) / 60.0)::NUMERIC, 1) as avg_chat_duration
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       JOIN events e ON e.id = gs.event_id
       WHERE e.organization_id = $1 AND gt.key = 'coffee-roulette' AND gs.status = 'finished'`,
      [orgId]
    );

    const uniqueParticipants = parseInt(pairingStats?.unique_participants || '0');
    const totalPairings = parseInt(pairingStats?.total_pairings || '0');
    const possiblePairings = uniqueParticipants > 1 ? (uniqueParticipants * (uniqueParticipants - 1)) / 2 : 1;

    return {
      totalPairings,
      uniqueParticipants,
      avgChatDurationMinutes: parseFloat(durationStats?.avg_chat_duration || '0'),
      connectionDensity: Math.round((totalPairings / possiblePairings) * 100 * 10) / 10,
      topConnectors: [], // Would need participant-level aggregation
    };
  }

  private async getSentimentInsights(orgId: string) {
    const [postStats] = await query<any>(
      `SELECT
         COUNT(DISTINCT ap.id) as total_posts,
         COUNT(DISTINCT pr.id) as total_reactions,
         COUNT(DISTINCT ap.author_participant_id) as unique_posters,
         COUNT(DISTINCT p.id) as total_event_participants
       FROM events e
       LEFT JOIN activity_posts ap ON ap.event_id = e.id
       LEFT JOIN post_reactions pr ON pr.post_id = ap.id
       LEFT JOIN participants p ON p.event_id = e.id
       WHERE e.organization_id = $1`,
      [orgId]
    );

    const totalPosts = parseInt(postStats?.total_posts || '0');
    const totalReactions = parseInt(postStats?.total_reactions || '0');
    const totalParticipants = parseInt(postStats?.total_event_participants || '1');
    const uniquePosters = parseInt(postStats?.unique_posters || '0');

    const weeklyTrend = await query<any>(
      `SELECT
         TO_CHAR(DATE_TRUNC('week', ap.created_at), 'YYYY-MM-DD') as week,
         COUNT(DISTINCT ap.id) as posts,
         COUNT(DISTINCT pr.id) as reactions
       FROM activity_posts ap
       LEFT JOIN post_reactions pr ON pr.post_id = ap.id
       JOIN events e ON e.id = ap.event_id
       WHERE e.organization_id = $1
       AND ap.created_at > NOW() - INTERVAL '12 weeks'
       GROUP BY DATE_TRUNC('week', ap.created_at)
       ORDER BY week ASC`,
      [orgId]
    );

    return {
      totalPosts,
      totalReactions,
      avgReactionsPerPost: totalPosts > 0 ? Math.round((totalReactions / totalPosts) * 10) / 10 : 0,
      participationRate: Math.round((uniquePosters / totalParticipants) * 100 * 10) / 10,
      topCategories: [],
      weeklyTrend: weeklyTrend.map((w: any) => ({
        week: w.week,
        posts: parseInt(w.posts),
        reactions: parseInt(w.reactions),
      })),
    };
  }

  private async getCollaborationInsights(orgId: string) {
    const [escapeStats] = await query<any>(
      `SELECT
         COUNT(DISTINCT gs.id) as total_games,
         ROUND(AVG(
           (SELECT COUNT(DISTINCT ga2.participant_id) FROM game_actions ga2 WHERE ga2.game_session_id = gs.id)
         )::NUMERIC, 1) as avg_team_size,
         ROUND(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at)) / 60.0)::NUMERIC, 1) as avg_discussion_minutes,
         ROUND(
           COUNT(CASE WHEN gs.status = 'finished' THEN 1 END)::NUMERIC /
           NULLIF(COUNT(gs.id), 0) * 100, 1
         ) as completion_rate
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       JOIN events e ON e.id = gs.event_id
       WHERE e.organization_id = $1 AND gt.key = 'strategic-escape'`,
      [orgId]
    );

    return {
      totalGames: parseInt(escapeStats?.total_games || '0'),
      avgTeamSize: parseFloat(escapeStats?.avg_team_size || '0'),
      avgDiscussionMinutes: parseFloat(escapeStats?.avg_discussion_minutes || '0'),
      completionRate: parseFloat(escapeStats?.completion_rate || '0'),
      difficultyBreakdown: [],
    };
  }

  private async getParticipationTrend(orgId: string) {
    return query<any>(
      `SELECT
         TO_CHAR(gs.started_at, 'Mon') as month,
         COUNT(DISTINCT p.id) as participants,
         COUNT(DISTINCT gs.id) as sessions
       FROM game_sessions gs
       JOIN events e ON e.id = gs.event_id
       LEFT JOIN participants p ON p.event_id = e.id
       WHERE e.organization_id = $1
       AND gs.started_at > NOW() - INTERVAL '6 months'
       GROUP BY TO_CHAR(gs.started_at, 'Mon'), EXTRACT(MONTH FROM gs.started_at)
       ORDER BY EXTRACT(MONTH FROM gs.started_at) ASC`,
      [orgId]
    );
  }
}

export const hrAnalyticsService = new HRAnalyticsService();
