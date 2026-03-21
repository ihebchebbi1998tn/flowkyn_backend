import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface UserEngagementMetrics {
  id: string;
  user_id: string;
  engagement_score: number; // 0-100
  last_active_at: string;
  total_sessions: number;
  total_games_played: number;
  average_session_duration_minutes: number;
  user_tags: string[];
  current_streak_days: number;
  highest_streak_days: number;
  created_at: string;
  updated_at: string;
}

export class UserEngagementService {
  /**
   * Get user engagement metrics
   */
  async getUserMetrics(userId: string): Promise<UserEngagementMetrics | null> {
    try {
      const result = await query<UserEngagementMetrics>(
        'SELECT * FROM user_engagement_metrics WHERE user_id = $1',
        [userId]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get user engagement metrics: ${userId}`, 500);
    }
  }

  /**
   * Get or create user engagement metrics
   */
  async getOrCreateMetrics(userId: string): Promise<UserEngagementMetrics> {
    try {
      let metrics = await this.getUserMetrics(userId);
      if (metrics) return metrics;

      const result = await query<UserEngagementMetrics>(
        `INSERT INTO user_engagement_metrics (user_id, engagement_score, total_sessions, total_games_played, average_session_duration_minutes, current_streak_days, highest_streak_days)
         VALUES ($1, 0, 0, 0, 0, 0, 0)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [userId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to get or create engagement metrics for user: ${userId}`, 500);
    }
  }

  /**
   * Record user activity (increments engagement)
   */
  async recordActivity(userId: string, activityType: 'session_started' | 'game_completed' | 'message_sent' | 'interaction'): Promise<UserEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(userId);
      
      // Calculate engagement based on activity
      let scoreIncrease = 0;
      let sessionIncrease = 0;
      let gameIncrease = 0;

      switch (activityType) {
        case 'session_started':
          scoreIncrease = 5;
          sessionIncrease = 1;
          break;
        case 'game_completed':
          scoreIncrease = 15;
          gameIncrease = 1;
          break;
        case 'message_sent':
          scoreIncrease = 2;
          break;
        case 'interaction':
          scoreIncrease = 3;
          break;
      }

      const newScore = Math.min(100, metrics.engagement_score + scoreIncrease);

      const result = await query<UserEngagementMetrics>(
        `UPDATE user_engagement_metrics 
         SET engagement_score = $1,
             total_sessions = total_sessions + $2,
             total_games_played = total_games_played + $3,
             last_active_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $4
         RETURNING *`,
        [newScore, sessionIncrease, gameIncrease, userId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to record activity for user: ${userId}`, 500);
    }
  }

  /**
   * Add tag to user (for segmentation)
   */
  async addTag(userId: string, tag: string): Promise<UserEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(userId);
      const tags = metrics.user_tags || [];

      if (!tags.includes(tag)) {
        tags.push(tag);

        const result = await query<UserEngagementMetrics>(
          `UPDATE user_engagement_metrics 
           SET user_tags = $1, updated_at = NOW()
           WHERE user_id = $2
           RETURNING *`,
          [JSON.stringify(tags), userId]
        );
        return result[0];
      }

      return metrics;
    } catch (err) {
      throw new AppError(`Failed to add tag to user: ${userId}`, 500);
    }
  }

  /**
   * Remove tag from user
   */
  async removeTag(userId: string, tag: string): Promise<UserEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(userId);
      const tags = (metrics.user_tags || []).filter((t) => t !== tag);

      const result = await query<UserEngagementMetrics>(
        `UPDATE user_engagement_metrics 
         SET user_tags = $1, updated_at = NOW()
         WHERE user_id = $2
         RETURNING *`,
        [JSON.stringify(tags), userId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to remove tag from user: ${userId}`, 500);
    }
  }

  /**
   * Update session duration
   */
  async updateSessionDuration(userId: string, durationMinutes: number): Promise<UserEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(userId);
      const totalMinutes = (metrics.average_session_duration_minutes * metrics.total_sessions + durationMinutes) / Math.max(1, metrics.total_sessions);

      const result = await query<UserEngagementMetrics>(
        `UPDATE user_engagement_metrics 
         SET average_session_duration_minutes = $1, updated_at = NOW()
         WHERE user_id = $2
         RETURNING *`,
        [Math.round(totalMinutes * 100) / 100, userId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update session duration for user: ${userId}`, 500);
    }
  }

  /**
   * Update user streak (consecutive days active)
   */
  async updateStreak(userId: string): Promise<UserEngagementMetrics> {
    try {
      const metrics = await this.getOrCreateMetrics(userId);
      const lastActive = new Date(metrics.last_active_at);
      const today = new Date();
      const daysDifference = Math.floor((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

      let newStreak = metrics.current_streak_days;
      if (daysDifference === 0) {
        // Same day, maintain streak
        newStreak = metrics.current_streak_days;
      } else if (daysDifference === 1) {
        // Consecutive day, increase streak
        newStreak = metrics.current_streak_days + 1;
      } else {
        // Streak broken, reset to 1
        newStreak = 1;
      }

      const highestStreak = Math.max(newStreak, metrics.highest_streak_days);

      const result = await query<UserEngagementMetrics>(
        `UPDATE user_engagement_metrics 
         SET current_streak_days = $1, highest_streak_days = $2, updated_at = NOW()
         WHERE user_id = $3
         RETURNING *`,
        [newStreak, highestStreak, userId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update streak for user: ${userId}`, 500);
    }
  }

  /**
   * Get top engaged users
   */
  async getTopUsers(limit: number = 10): Promise<UserEngagementMetrics[]> {
    try {
      const result = await query<UserEngagementMetrics>(
        'SELECT * FROM user_engagement_metrics ORDER BY engagement_score DESC LIMIT $1',
        [limit]
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get top engaged users', 500);
    }
  }

  /**
   * Get users by tag
   */
  async getUsersByTag(tag: string, page: number = 1, limit: number = 20): Promise<{ data: UserEngagementMetrics[]; total: number }> {
    try {
      const offset = (page - 1) * limit;

      const [users, counts] = await Promise.all([
        query<UserEngagementMetrics>(
          `SELECT * FROM user_engagement_metrics WHERE user_tags @> $1 ORDER BY engagement_score DESC LIMIT $2 OFFSET $3`,
          [JSON.stringify([tag]), limit, offset]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) FROM user_engagement_metrics WHERE user_tags @> $1`,
          [JSON.stringify([tag])]
        ),
      ]);

      return { data: users, total: Number(counts[0]?.count || 0) };
    } catch (err) {
      throw new AppError(`Failed to get users with tag: ${tag}`, 500);
    }
  }

  /**
   * Get engagement timeline for a user (activity over time)
   */
  async getEngagementTimeline(
    userId: string,
    options: { days?: number; interval?: 'hour' | 'day' | 'week' }
  ): Promise<Array<{ timestamp: string; score: number; sessions: number }>> {
    try {
      const days = options.days || 30;
      const interval = options.interval || 'day';

      const result = await query<any>(
        `SELECT 
          DATE_TRUNC('${interval}', created_at) as timestamp,
          engagement_score as score,
          COUNT(*) as sessions
         FROM user_engagement_metrics
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE_TRUNC('${interval}', created_at), engagement_score
         ORDER BY timestamp DESC`,
        [userId]
      );

      return result.map((row) => ({
        timestamp: row.timestamp,
        score: Number(row.score),
        sessions: Number(row.sessions),
      }));
    } catch (err) {
      throw new AppError(`Failed to get engagement timeline for user: ${userId}`, 500);
    }
  }

  /**
   * Get engagement statistics
   */
  async getEngagementStats(): Promise<{
    totalUsers: number;
    averageScore: number;
    averageSessions: number;
    averageGamesPlayed: number;
    topTag: string;
    activeToday: number;
  }> {
    try {
      const [stats, activeUsers, tagStats] = await Promise.all([
        query<any>(
          `SELECT 
            COUNT(*) as total,
            AVG(engagement_score) as avg_score,
            AVG(total_sessions) as avg_sessions,
            AVG(total_games_played) as avg_games
           FROM user_engagement_metrics`
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) FROM user_engagement_metrics WHERE last_active_at >= NOW() - INTERVAL '24 hours'`
        ),
        query<any>(
          `SELECT user_tags, COUNT(*) as count FROM user_engagement_metrics GROUP BY user_tags ORDER BY count DESC LIMIT 1`
        ),
      ]);

      return {
        totalUsers: Number(stats[0]?.total || 0),
        averageScore: Number(stats[0]?.avg_score || 0),
        averageSessions: Number(stats[0]?.avg_sessions || 0),
        averageGamesPlayed: Number(stats[0]?.avg_games || 0),
        topTag: tagStats[0]?.user_tags?.[0] || 'none',
        activeToday: Number(activeUsers[0]?.count || 0),
      };
    } catch (err) {
      throw new AppError('Failed to get engagement statistics', 500);
    }
  }
}

export const userEngagementService = new UserEngagementService();
