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
      // Total team members across orgs (active members + pending invitations)
      (async () => {
        const [{ active_count }] = await query<{ active_count: string }>(
          `SELECT COUNT(DISTINCT om.user_id) as active_count FROM organization_members om
           WHERE om.organization_id IN (${placeholders}) AND om.status = 'active'`,
          ids
        );
        const [{ pending_count }] = await query<{ pending_count: string }>(
          `SELECT COUNT(*) as pending_count FROM organization_invitations oi
           WHERE oi.organization_id IN (${placeholders}) AND oi.status = 'pending'`,
          ids
        );
        return [{ team_members: String(parseInt(active_count) + parseInt(pending_count)) }];
      })(),
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

  /**
   * Get detailed engagement metrics for an organization.
   */
  async getEngagementMetrics(userId: string, organizationId: string) {
    // Verify user has access to org
    const access = await queryOne(
      `SELECT om.id FROM organization_members om
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, organizationId]
    );
    if (!access) throw new Error('Access denied');

    const [engagementMetrics] = await Promise.all([
      query<any>(
        `SELECT
           COUNT(DISTINCT p.user_id) as total_participants,
           COUNT(DISTINCT e.id) as total_events,
           COUNT(DISTINCT gs.id) as total_sessions,
           ROUND(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at)) / 60.0)::NUMERIC, 1) as avg_session_duration_minutes,
           ROUND(
             COUNT(CASE WHEN gs.status = 'finished' THEN 1 END)::NUMERIC / 
             NULLIF(COUNT(gs.id), 0) * 100, 1
           ) as session_completion_rate,
           COUNT(DISTINCT CASE WHEN p.left_at IS NULL THEN p.id END) as active_participants_now,
           MAX(gs.started_at) as last_session_at
         FROM events e
         LEFT JOIN participants p ON p.event_id = e.id
         LEFT JOIN game_sessions gs ON gs.event_id = e.id
         WHERE e.organization_id = $1`,
        [organizationId]
      ),
    ]);

    return engagementMetrics[0] || {
      total_participants: 0,
      total_events: 0,
      total_sessions: 0,
      avg_session_duration_minutes: 0,
      session_completion_rate: 0,
      active_participants_now: 0,
      last_session_at: null,
    };
  }

  /**
   * Get real-time metrics dashboard.
   */
  async getRealTimeMetrics(userId: string, organizationId: string) {
    // Verify access
    const access = await queryOne(
      `SELECT om.id FROM organization_members om
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, organizationId]
    );
    if (!access) throw new Error('Access denied');

    const [
      activeSessions,
      onlineParticipants,
      recentSessions,
      gameBreakdown,
    ] = await Promise.all([
      // Active sessions
      query<any>(
        `SELECT 
           gs.id, gs.status, gs.current_round, gs.started_at,
           gt.name as game_name, gt.key as game_key,
           e.title as event_title,
           COUNT(p.id) as participant_count
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN participants p ON p.event_id = e.id AND p.left_at IS NULL
         WHERE e.organization_id = $1 AND gs.status IN ('active', 'paused')
         GROUP BY gs.id, gs.status, gs.current_round, gs.started_at, gt.name, gt.key, e.title
         ORDER BY gs.started_at DESC`,
        [organizationId]
      ),
      // Online participants
      query<any>(
        `SELECT COUNT(DISTINCT p.id) as count FROM participants p
         JOIN events e ON e.id = p.event_id
         WHERE e.organization_id = $1 AND p.left_at IS NULL`,
        [organizationId]
      ),
      // Recent completed sessions
      query<any>(
        `SELECT 
           gs.id, gs.status, gs.ended_at, gt.name as game_name,
           e.title as event_title,
           COUNT(DISTINCT p.id) as participant_count
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN participants p ON p.event_id = e.id
         WHERE e.organization_id = $1 AND gs.status = 'finished'
         AND gs.ended_at > NOW() - INTERVAL '24 hours'
         GROUP BY gs.id, gs.status, gs.ended_at, gt.name, e.title
         ORDER BY gs.ended_at DESC
         LIMIT 10`,
        [organizationId]
      ),
      // Game type breakdown
      query<any>(
        `SELECT 
           gt.name, gt.key, 
           COUNT(DISTINCT gs.id) as session_count,
           COUNT(DISTINCT p.id) as total_participants,
           ROUND(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at)) / 60.0)::NUMERIC, 1) as avg_duration_minutes
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         JOIN events e ON e.id = gs.event_id
         LEFT JOIN participants p ON p.event_id = e.id
         WHERE e.organization_id = $1 AND gs.created_at > NOW() - INTERVAL '30 days'
         GROUP BY gt.name, gt.key
         ORDER BY session_count DESC`,
        [organizationId]
      ),
    ]);

    return {
      activeSessions,
      onlineParticipantsCount: onlineParticipants[0]?.count || 0,
      recentSessions,
      gameBreakdown,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get event performance analytics.
   */
  async getEventAnalytics(userId: string, eventId: string) {
    // Verify access
    const event = await queryOne(
      `SELECT e.id, e.organization_id FROM events e
       WHERE e.id = $1`,
      [eventId]
    );
    if (!event) throw new Error('Event not found');

    const access = await queryOne(
      `SELECT om.id FROM organization_members om
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, event.organization_id]
    );
    if (!access) throw new Error('Access denied');

    const [
      eventDetails,
      sessionMetrics,
      participantBreakdown,
      timelineData,
      messageStats,
      feedbackStats,
    ] = await Promise.all([
      queryOne<any>(
        `SELECT 
           e.id, e.title, e.status, e.event_mode, e.created_at, e.start_time, e.end_time,
           COUNT(DISTINCT p.id) as total_participants,
           COUNT(DISTINCT p.id) FILTER (WHERE p.left_at IS NULL) as active_participants,
           COUNT(DISTINCT gs.id) as total_sessions,
           COUNT(DISTINCT em.id) as total_messages,
           ROUND(EXTRACT(EPOCH FROM (COALESCE(e.end_time, NOW()) - e.start_time)) / 60) as duration_minutes
         FROM events e
         LEFT JOIN participants p ON p.event_id = e.id
         LEFT JOIN game_sessions gs ON gs.event_id = e.id
         LEFT JOIN event_messages em ON em.event_id = e.id
         WHERE e.id = $1
         GROUP BY e.id, e.title, e.status, e.event_mode, e.created_at, e.start_time, e.end_time`,
        [eventId]
      ),
      // Session metrics with actual per-session participant counts
      query<any>(
        `SELECT 
           gs.id, gs.status, gs.current_round, gs.started_at, gs.ended_at,
           gt.name as game_name, gt.key as game_key,
           ROUND(EXTRACT(EPOCH FROM (COALESCE(gs.ended_at, NOW()) - gs.started_at)) / 60) as duration_minutes,
           (SELECT COUNT(DISTINCT ga.participant_id) FROM game_actions ga WHERE ga.game_session_id = gs.id) as participant_count,
           (SELECT COUNT(*) FROM game_actions ga WHERE ga.game_session_id = gs.id) as total_actions
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         WHERE gs.event_id = $1
         ORDER BY gs.started_at DESC`,
        [eventId]
      ),
      // Participant engagement with proper name resolution
      query<any>(
        `SELECT 
           p.id,
           COALESCE(ep.display_name, p.guest_name, u.name, 'Unknown') as display_name,
           COALESCE(ep.avatar_url, p.guest_avatar, u.avatar_url) as avatar_url,
           p.participant_type,
           p.joined_at, p.left_at,
           COUNT(DISTINCT ga.id) as interaction_count,
           COUNT(DISTINCT em.id) as message_count,
           MAX(GREATEST(ga.created_at, em.created_at)) as last_activity_at
         FROM participants p
         LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         LEFT JOIN game_actions ga ON ga.participant_id = p.id
         LEFT JOIN event_messages em ON em.participant_id = p.id AND em.event_id = p.event_id
         WHERE p.event_id = $1
         GROUP BY p.id, ep.display_name, p.guest_name, u.name, ep.avatar_url, p.guest_avatar, u.avatar_url,
                  p.participant_type, p.joined_at, p.left_at
         ORDER BY interaction_count DESC`,
        [eventId]
      ),
      // Timeline of sessions
      query<any>(
        `SELECT 
           gs.id, gs.started_at, gs.ended_at, gs.status,
           gt.name as game_name,
           (SELECT COUNT(DISTINCT ga.participant_id) FROM game_actions ga WHERE ga.game_session_id = gs.id) as participant_count
         FROM game_sessions gs
         JOIN game_types gt ON gt.id = gs.game_type_id
         WHERE gs.event_id = $1
         GROUP BY gs.id, gs.started_at, gs.ended_at, gs.status, gt.name
         ORDER BY gs.started_at ASC`,
        [eventId]
      ),
      // Message activity over time (hourly buckets)
      query<any>(
        `SELECT 
           date_trunc('hour', em.created_at) as hour,
           COUNT(*) as message_count,
           COUNT(DISTINCT em.participant_id) as active_senders
         FROM event_messages em
         WHERE em.event_id = $1
         GROUP BY date_trunc('hour', em.created_at)
         ORDER BY hour ASC`,
        [eventId]
      ),
      // Feedback summary
      query<any>(
        `SELECT 
           ROUND(AVG(af.rating), 1) as avg_rating,
           COUNT(*) as total_feedbacks,
           COUNT(*) FILTER (WHERE af.rating >= 4) as positive_count,
           COUNT(*) FILTER (WHERE af.rating <= 2) as negative_count
         FROM activity_feedbacks af
         WHERE af.event_id = $1`,
        [eventId]
      ),
    ]);

    // Compute engagement rate: participants with at least 1 action / total participants
    const totalP = parseInt(eventDetails?.total_participants || '0');
    const activeInteractors = participantBreakdown.filter((p: any) => parseInt(p.interaction_count) > 0).length;
    const engagementRate = totalP > 0 ? Math.round((activeInteractors / totalP) * 100) : 0;

    return {
      event: { ...eventDetails, engagement_rate: engagementRate },
      sessions: sessionMetrics,
      participants: participantBreakdown,
      timeline: timelineData,
      messageActivity: messageStats,
      feedback: feedbackStats[0] || { avg_rating: null, total_feedbacks: 0, positive_count: 0, negative_count: 0 },
    };
  }

  /**
   * Get leaderboards and rankings.
   */
  async getParticipantRankings(userId: string, organizationId: string, limit = 20) {
    // Verify access
    const access = await queryOne(
      `SELECT om.id FROM organization_members om
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, organizationId]
    );
    if (!access) throw new Error('Access denied');

    return query<any>(
      `SELECT 
         p.id, p.display_name, p.avatar_seed,
         COUNT(DISTINCT gs.id) as sessions_participated,
         COUNT(DISTINCT e.id) as events_attended,
         COUNT(DISTINCT ga.id) as total_interactions,
         ROUND(AVG(
           CASE WHEN gs.status = 'finished' THEN 1 ELSE 0 END
         )::NUMERIC * 100, 1) as completion_rate
       FROM participants p
       LEFT JOIN events e ON e.id = p.event_id
       LEFT JOIN game_sessions gs ON gs.event_id = e.id
       LEFT JOIN game_actions ga ON ga.participant_id = p.id
       WHERE e.organization_id = $1
       GROUP BY p.id, p.display_name, p.avatar_seed
       ORDER BY total_interactions DESC, sessions_participated DESC
       LIMIT $2`,
      [organizationId, limit]
    );
  }
}
