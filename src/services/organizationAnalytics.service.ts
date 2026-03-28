import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface OrganizationEngagementMetrics {
  id: string;
  org_id: string;
  health_score: number; // 0-100
  member_count: number;
  active_member_count: number;
  average_engagement_score: number;
  feature_adoption_percentage: number;
  total_sessions_this_month: number;
  total_games_this_month: number;
  average_session_duration_minutes: number;
  retention_rate: number; // 0-100
  created_at: string;
  updated_at: string;
}

export class OrganizationAnalyticsService {
  /**
   * Get organization engagement metrics
   */
  async getOrgMetrics(orgId: string): Promise<OrganizationEngagementMetrics | null> {
    try {
      const result = await query<OrganizationEngagementMetrics>(
        'SELECT * FROM organization_engagement_metrics WHERE org_id = $1',
        [orgId]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get organization metrics: ${orgId}`, 500);
    }
  }

  /**
   * Get or create organization metrics
   */
  async getOrCreateMetrics(orgId: string): Promise<OrganizationEngagementMetrics> {
    try {
      let metrics = await this.getOrgMetrics(orgId);
      if (metrics) return metrics;

      const result = await query<OrganizationEngagementMetrics>(
        `INSERT INTO organization_engagement_metrics (org_id, health_score, member_count, active_member_count, average_engagement_score, feature_adoption_percentage, total_sessions_this_month, total_games_this_month, average_session_duration_minutes, retention_rate)
         VALUES ($1, 50, 0, 0, 0, 0, 0, 0, 0, 100)
         ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [orgId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to get or create metrics for organization: ${orgId}`, 500);
    }
  }

  /**
   * Update organization health score based on engagement metrics
   */
  async updateHealthScore(orgId: string): Promise<OrganizationEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(orgId);

      // Health score is weighted average of:
      // - Member engagement (40%)
      // - Retention rate (30%)
      // - Feature adoption (20%)
      // - Activity level (10%)
      const healthScore = Math.round(
        metrics.average_engagement_score * 0.4 +
          metrics.retention_rate * 0.3 +
          metrics.feature_adoption_percentage * 0.2 +
          Math.min(100, (metrics.total_games_this_month / 100) * 100) * 0.1
      );

      const result = await query<OrganizationEngagementMetrics>(
        `UPDATE organization_engagement_metrics 
         SET health_score = $1, updated_at = NOW()
         WHERE org_id = $2
         RETURNING *`,
        [Math.max(0, Math.min(100, healthScore)), orgId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update health score for organization: ${orgId}`, 500);
    }
  }

  /**
   * Update member count and active members
   */
  async updateMemberCounts(orgId: string): Promise<OrganizationEngagementMetrics> {
    try {
      const result = await query<OrganizationEngagementMetrics>(
        `UPDATE organization_engagement_metrics 
         SET active_member_count = (
           SELECT COUNT(DISTINCT user_id) FROM user_engagement_metrics 
           WHERE user_tags @> $1 AND last_active_at >= NOW() - INTERVAL '30 days'
         ),
         updated_at = NOW()
         WHERE org_id = $2
         RETURNING *`,
        [JSON.stringify([orgId]), orgId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update member counts for organization: ${orgId}`, 500);
    }
  }

  /**
   * Update feature adoption percentage
   */
  async updateFeatureAdoption(orgId: string, featureKey: string): Promise<void> {
    try {
      // Increment adoption count for feature in this org
      await query(
        `UPDATE organization_engagement_metrics 
         SET feature_adoption_percentage = feature_adoption_percentage + 1
         WHERE org_id = $1 AND feature_adoption_percentage < 100`,
        [orgId]
      );
    } catch (err) {
      console.error(`Failed to update feature adoption for org ${orgId}:`, err);
      // Don't throw - this is tracked separately
    }
  }

  /**
   * Record organization activity (sessions, games)
   */
  async recordOrgActivity(orgId: string, activityType: 'session' | 'game'): Promise<OrganizationEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(orgId);

      let sessionIncrease = 0;
      let gameIncrease = 0;

      if (activityType === 'session') {
        sessionIncrease = 1;
      } else if (activityType === 'game') {
        gameIncrease = 1;
      }

      const result = await query<OrganizationEngagementMetrics>(
        `UPDATE organization_engagement_metrics 
         SET total_sessions_this_month = total_sessions_this_month + $1,
             total_games_this_month = total_games_this_month + $2,
             updated_at = NOW()
         WHERE org_id = $3
         RETURNING *`,
        [sessionIncrease, gameIncrease, orgId]
      );

      // Update health score after activity
      await this.updateHealthScore(orgId);

      return result[0];
    } catch (err) {
      throw new AppError(`Failed to record activity for organization: ${orgId}`, 500);
    }
  }

  /**
   * Get top performing organizations
   */
  async getTopOrganizations(limit: number = 10): Promise<OrganizationEngagementMetrics[]> {
    try {
      const result = await query<OrganizationEngagementMetrics>(
        'SELECT * FROM organization_engagement_metrics ORDER BY health_score DESC LIMIT $1',
        [limit]
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get top organizations', 500);
    }
  }

  /**
   * Get organizations needing attention (low health score)
   */
  async getAtRiskOrganizations(healthThreshold: number = 40): Promise<OrganizationEngagementMetrics[]> {
    try {
      const result = await query<OrganizationEngagementMetrics>(
        'SELECT * FROM organization_engagement_metrics WHERE health_score < $1 ORDER BY health_score ASC',
        [healthThreshold]
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get at-risk organizations', 500);
    }
  }

  /**
   * Get organization comparison metrics
   */
  async getOrgComparison(orgIds: string[]): Promise<OrganizationEngagementMetrics[]> {
    try {
      if (orgIds.length === 0) return [];

      const placeholders = orgIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await query<OrganizationEngagementMetrics>(
        `SELECT * FROM organization_engagement_metrics WHERE org_id IN (${placeholders})`,
        orgIds
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get organization comparison', 500);
    }
  }

  /**
   * Get organization trends over time
   */
  async getOrgTrends(orgId: string, days: number = 30): Promise<
    Array<{
      date: string;
      health_score: number;
      active_members: number;
      sessions: number;
      games: number;
    }>
  > {
    try {
      const result = await query<any>(
        `SELECT 
          DATE(created_at) as date,
          health_score,
          active_member_count as active_members,
          total_sessions_this_month as sessions,
          total_games_this_month as games
         FROM organization_engagement_metrics
         WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
         ORDER BY created_at DESC`,
        [orgId]
      );

      return result.map((row) => ({
        date: row.date,
        health_score: Number(row.health_score),
        active_members: Number(row.active_members),
        sessions: Number(row.sessions),
        games: Number(row.games),
      }));
    } catch (err) {
      throw new AppError(`Failed to get trends for organization: ${orgId}`, 500);
    }
  }

  /**
   * Get analytics dashboard data for all organizations
   */
  async getDashboardData(): Promise<{
    totalOrganizations: number;
    averageHealthScore: number;
    organizationsAboveThreshold: number;
    organizationsBelowThreshold: number;
    totalActiveMembers: number;
    totalSessionsThisMonth: number;
    topOrganizations: OrganizationEngagementMetrics[];
    atRiskOrganizations: OrganizationEngagementMetrics[];
  }> {
    try {
      const [stats, top, atRisk] = await Promise.all([
        query<any>(
          `SELECT 
            COUNT(*) as total,
            AVG(health_score) as avg_health,
            SUM(CASE WHEN health_score >= 60 THEN 1 ELSE 0 END) as above_threshold,
            SUM(CASE WHEN health_score < 60 THEN 1 ELSE 0 END) as below_threshold,
            SUM(active_member_count) as total_active,
            SUM(total_sessions_this_month) as total_sessions
           FROM organization_engagement_metrics`
        ),
        this.getTopOrganizations(5),
        this.getAtRiskOrganizations(40),
      ]);

      return {
        totalOrganizations: Number(stats[0]?.total || 0),
        averageHealthScore: Number(stats[0]?.avg_health || 0),
        organizationsAboveThreshold: Number(stats[0]?.above_threshold || 0),
        organizationsBelowThreshold: Number(stats[0]?.below_threshold || 0),
        totalActiveMembers: Number(stats[0]?.total_active || 0),
        totalSessionsThisMonth: Number(stats[0]?.total_sessions || 0),
        topOrganizations: top,
        atRiskOrganizations: atRisk,
      };
    } catch (err) {
      throw new AppError('Failed to get dashboard data', 500);
    }
  }
}

export const organizationAnalyticsService = new OrganizationAnalyticsService();
