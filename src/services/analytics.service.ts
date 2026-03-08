import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';

export class AnalyticsService {
  async track(userId: string, eventName: string, properties: any) {
    const [event] = await query(
      `INSERT INTO analytics_events (id, user_id, event_name, properties, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [uuid(), userId, eventName, JSON.stringify(properties)]
    );
    return event;
  }

  /**
   * Dashboard stats for a user — aggregated across all their organizations.
   */
  async getDashboardStats(userId: string) {
    // Get all orgs this user belongs to
    const orgIds = await query<{ organization_id: string }>(
      `SELECT organization_id FROM organization_members WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const ids = orgIds.map(o => o.organization_id);

    if (ids.length === 0) {
      return {
        activeSessions: 0,
        teamMembers: 0,
        totalEvents: 0,
        completedSessions: 0,
        upcomingEvents: [],
        recentActivity: [],
      };
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const [
      [{ active_sessions }],
      [{ team_members }],
      [{ total_events }],
      [{ completed_sessions }],
      upcomingEvents,
      recentActivity,
    ] = await Promise.all([
      // Active game sessions
      query<{ active_sessions: string }>(
        `SELECT COUNT(*) as active_sessions FROM game_sessions gs
         JOIN events e ON e.id = gs.event_id
         WHERE e.organization_id IN (${placeholders}) AND gs.status = 'active'`,
        ids
      ),
      // Total team members across orgs
      query<{ team_members: string }>(
        `SELECT COUNT(DISTINCT om.user_id) as team_members FROM organization_members om
         WHERE om.organization_id IN (${placeholders}) AND om.status = 'active'`,
        ids
      ),
      // Total events
      query<{ total_events: string }>(
        `SELECT COUNT(*) as total_events FROM events
         WHERE organization_id IN (${placeholders})`,
        ids
      ),
      // Completed sessions (last 30 days)
      query<{ completed_sessions: string }>(
        `SELECT COUNT(*) as completed_sessions FROM game_sessions gs
         JOIN events e ON e.id = gs.event_id
         WHERE e.organization_id IN (${placeholders}) AND gs.status = 'finished'
         AND gs.ended_at > NOW() - INTERVAL '30 days'`,
        ids
      ),
      // Upcoming events (active, with start_time in future or no start_time)
      query<any>(
        `SELECT e.id, e.title, e.event_mode, e.start_time, e.status, e.max_participants,
                (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.left_at IS NULL) as participant_count
         FROM events e
         WHERE e.organization_id IN (${placeholders})
         AND e.status IN ('draft', 'active')
         ORDER BY e.start_time ASC NULLS LAST
         LIMIT 5`,
        ids
      ),
      // Recent game sessions
      query<any>(
        `SELECT gs.id, gs.status, gs.current_round, gs.started_at, gs.ended_at,
                gt.name as game_type_name, gt.key as game_type_key,
                e.title as event_title
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         WHERE e.organization_id IN (${placeholders})
         ORDER BY gs.started_at DESC
         LIMIT 10`,
        ids
      ),
    ]);

    return {
      activeSessions: parseInt(active_sessions),
      teamMembers: parseInt(team_members),
      totalEvents: parseInt(total_events),
      completedSessions: parseInt(completed_sessions),
      upcomingEvents,
      recentActivity,
    };
  }

  /**
   * Analytics overview — engagement trends, activity breakdown, participation.
   */
  async getOverview(userId: string, months = 6) {
    const orgIds = await query<{ organization_id: string }>(
      `SELECT organization_id FROM organization_members WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const ids = orgIds.map(o => o.organization_id);

    if (ids.length === 0) {
      return { engagementTrend: [], activityBreakdown: [], participationByTeam: [], topActivities: [], stats: { totalSessions: 0, totalParticipants: 0, avgRating: 0, completionRate: 0 } };
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const monthsParam = `$${ids.length + 1}`;

    const [
      engagementTrend,
      activityBreakdown,
      topActivities,
      [stats],
    ] = await Promise.all([
      // Monthly engagement trend (sessions per month)
      query<any>(
        `SELECT TO_CHAR(gs.started_at, 'Mon') as month,
                EXTRACT(MONTH FROM gs.started_at) as month_num,
                COUNT(*) as sessions,
                COUNT(CASE WHEN gs.status = 'finished' THEN 1 END) as completed
         FROM game_sessions gs
         JOIN events e ON e.id = gs.event_id
         WHERE e.organization_id IN (${placeholders})
         AND gs.started_at > NOW() - (${monthsParam} || ' months')::INTERVAL
         GROUP BY TO_CHAR(gs.started_at, 'Mon'), EXTRACT(MONTH FROM gs.started_at)
         ORDER BY month_num ASC`,
        [...ids, String(months)]
      ),
      // Activity breakdown by game type
      query<any>(
        `SELECT gt.name, gt.category,
                COUNT(DISTINCT gs.id) as sessions,
                COUNT(DISTINCT ga.participant_id) as participants
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN game_actions ga ON ga.game_session_id = gs.id
         WHERE e.organization_id IN (${placeholders})
         GROUP BY gt.name, gt.category
         ORDER BY sessions DESC`,
        ids
      ),
      // Top activities by participation
      query<any>(
        `SELECT gt.name, gt.category,
                COUNT(DISTINCT gs.id) as sessions,
                COUNT(DISTINCT ga.participant_id) as participants,
                COUNT(ga.id) as total_actions
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN game_actions ga ON ga.game_session_id = gs.id
         WHERE e.organization_id IN (${placeholders})
         GROUP BY gt.name, gt.category
         ORDER BY participants DESC
         LIMIT 5`,
        ids
      ),
      // Aggregate stats
      query<any>(
        `SELECT
           COUNT(DISTINCT gs.id) as total_sessions,
           COUNT(DISTINCT ga.participant_id) as total_participants,
           ROUND(
             CASE WHEN COUNT(gs.id) = 0 THEN 0
             ELSE COUNT(CASE WHEN gs.status = 'finished' THEN 1 END)::NUMERIC / COUNT(gs.id) * 100
             END, 1
           ) as completion_rate
         FROM game_sessions gs
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN game_actions ga ON ga.game_session_id = gs.id
         WHERE e.organization_id IN (${placeholders})`,
        ids
      ),
    ]);

    return {
      engagementTrend,
      activityBreakdown,
      topActivities,
      stats: {
        totalSessions: parseInt(stats?.total_sessions || '0'),
        totalParticipants: parseInt(stats?.total_participants || '0'),
        completionRate: parseFloat(stats?.completion_rate || '0'),
      },
    };
  }

  /**
   * Get active game sessions for a user's organizations.
   */
  async getActiveSessions(userId: string) {
    return query<any>(
      `SELECT gs.id, gs.event_id, gs.game_type_id, gs.status, gs.current_round,
              gs.game_duration_minutes, gs.started_at, gs.metadata,
              gt.name as game_type_name, gt.key as game_type_key,
              e.title as event_title, o.name as organization_name
       FROM game_sessions gs
       JOIN game_types gt ON gt.id = gs.game_type_id
       JOIN events e ON e.id = gs.event_id
       JOIN organizations o ON o.id = e.organization_id
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active' AND gs.status = 'active'
       ORDER BY gs.started_at DESC`,
      [userId]
    );
  }
}
