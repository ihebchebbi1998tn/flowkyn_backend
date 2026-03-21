import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface GameContent {
  id: string;
  game_key: string;
  content_type: 'prompt' | 'puzzle' | 'challenge' | 'scenario';
  title: string;
  content: string;
  difficulty_level: 'easy' | 'medium' | 'hard';
  category?: string;
  tags?: string[];
  usage_count: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class GameContentService {
  /**
   * Get content by ID
   */
  async getContent(contentId: string): Promise<GameContent | null> {
    try {
      const result = await query<GameContent>(
        'SELECT * FROM game_content WHERE id = $1',
        [contentId]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get game content: ${contentId}`, 500);
    }
  }

  /**
   * List game content with filtering and pagination
   */
  async listContent(options: {
    gameKey?: string;
    contentType?: string;
    difficulty?: string;
    approvalStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: GameContent[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];
      let paramCount = 1;

      if (options.gameKey) {
        whereClause += ` AND game_key = $${paramCount}`;
        params.push(options.gameKey);
        paramCount++;
      }

      if (options.contentType) {
        whereClause += ` AND content_type = $${paramCount}`;
        params.push(options.contentType);
        paramCount++;
      }

      if (options.difficulty) {
        whereClause += ` AND difficulty_level = $${paramCount}`;
        params.push(options.difficulty);
        paramCount++;
      }

      if (options.approvalStatus) {
        whereClause += ` AND approval_status = $${paramCount}`;
        params.push(options.approvalStatus);
        paramCount++;
      }

      const [content, counts] = await Promise.all([
        query<GameContent>(
          `SELECT * FROM game_content WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
          [...params, limit, offset]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) FROM game_content WHERE ${whereClause}`,
          params
        ),
      ]);

      return { data: content, total: Number(counts[0]?.count || 0) };
    } catch (err) {
      throw new AppError('Failed to list game content', 500);
    }
  }

  /**
   * Create new game content
   */
  async createContent(
    data: {
      gameKey: string;
      contentType: 'prompt' | 'puzzle' | 'challenge' | 'scenario';
      title: string;
      content: string;
      difficultyLevel: 'easy' | 'medium' | 'hard';
      category?: string;
      tags?: string[];
    },
    createdBy: string
  ): Promise<GameContent> {
    try {
      const result = await query<GameContent>(
        `INSERT INTO game_content (game_key, content_type, title, content, difficulty_level, category, tags, created_by, approval_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING *`,
        [
          data.gameKey,
          data.contentType,
          data.title,
          data.content,
          data.difficultyLevel,
          data.category || null,
          data.tags ? JSON.stringify(data.tags) : null,
          createdBy,
        ]
      );
      return result[0];
    } catch (err) {
      throw new AppError('Failed to create game content', 500);
    }
  }

  /**
   * Update existing game content
   */
  async updateContent(
    contentId: string,
    data: Partial<{
      title: string;
      content: string;
      difficultyLevel: string;
      category: string;
      tags: string[];
    }>,
    updatedBy: string
  ): Promise<GameContent> {
    try {
      const content = await this.getContent(contentId);
      if (!content) throw new AppError(`Game content not found: ${contentId}`, 404);

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramCount = 1;

      if (data.title) {
        updates.push(`title = $${paramCount}`);
        values.push(data.title);
        paramCount++;
      }

      if (data.content) {
        updates.push(`content = $${paramCount}`);
        values.push(data.content);
        paramCount++;
      }

      if (data.difficultyLevel) {
        updates.push(`difficulty_level = $${paramCount}`);
        values.push(data.difficultyLevel);
        paramCount++;
      }

      if (data.category !== undefined) {
        updates.push(`category = $${paramCount}`);
        values.push(data.category || null);
        paramCount++;
      }

      if (data.tags) {
        updates.push(`tags = $${paramCount}`);
        values.push(JSON.stringify(data.tags));
        paramCount++;
      }

      updates.push(`updated_at = NOW()`);

      const result = await query<GameContent>(
        `UPDATE game_content SET ${updates.join(', ')} WHERE id = $${paramCount + 1} RETURNING *`,
        [...values, contentId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update game content: ${contentId}`, 500);
    }
  }

  /**
   * Delete game content
   */
  async deleteContent(contentId: string): Promise<void> {
    try {
      const content = await this.getContent(contentId);
      if (!content) throw new AppError(`Game content not found: ${contentId}`, 404);

      await query('DELETE FROM game_content WHERE id = $1', [contentId]);
    } catch (err) {
      throw new AppError(`Failed to delete game content: ${contentId}`, 500);
    }
  }

  /**
   * Approve content for use in games
   */
  async approveContent(contentId: string, approvedBy: string): Promise<GameContent> {
    try {
      const content = await this.getContent(contentId);
      if (!content) throw new AppError(`Game content not found: ${contentId}`, 404);

      const result = await query<GameContent>(
        `UPDATE game_content 
         SET approval_status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2 
         RETURNING *`,
        [approvedBy, contentId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to approve game content: ${contentId}`, 500);
    }
  }

  /**
   * Reject content
   */
  async rejectContent(contentId: string, reason: string, rejectedBy: string): Promise<GameContent> {
    try {
      const content = await this.getContent(contentId);
      if (!content) throw new AppError(`Game content not found: ${contentId}`, 404);

      const result = await query<GameContent>(
        `UPDATE game_content 
         SET approval_status = 'rejected', approved_by = $1, approved_at = NOW()
         WHERE id = $2 
         RETURNING *`,
        [rejectedBy, contentId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to reject game content: ${contentId}`, 500);
    }
  }

  /**
   * Increment usage count when content is used in a game session
   */
  async incrementUsageCount(contentId: string): Promise<void> {
    try {
      await query(
        'UPDATE game_content SET usage_count = usage_count + 1 WHERE id = $1',
        [contentId]
      );
    } catch (err) {
      console.error(`Failed to increment usage count for content ${contentId}:`, err);
      // Don't throw - usage tracking should not block game operations
    }
  }

  /**
   * Get content statistics for a specific game
   */
  async getGameContentStats(gameKey: string): Promise<{
    totalContent: number;
    byType: Record<string, number>;
    byDifficulty: Record<string, number>;
    byApprovalStatus: Record<string, number>;
    totalUsage: number;
  }> {
    try {
      const result = await query<any>(
        `SELECT 
          COUNT(*) as total,
          content_type,
          difficulty_level,
          approval_status,
          SUM(usage_count) as total_usage
         FROM game_content 
         WHERE game_key = $1 
         GROUP BY content_type, difficulty_level, approval_status`,
        [gameKey]
      );

      const stats = {
        totalContent: 0,
        byType: {} as Record<string, number>,
        byDifficulty: {} as Record<string, number>,
        byApprovalStatus: {} as Record<string, number>,
        totalUsage: 0,
      };

      result.forEach((row) => {
        stats.totalContent += Number(row.total);
        stats.byType[row.content_type] = (stats.byType[row.content_type] || 0) + Number(row.total);
        stats.byDifficulty[row.difficulty_level] = (stats.byDifficulty[row.difficulty_level] || 0) + Number(row.total);
        stats.byApprovalStatus[row.approval_status] = (stats.byApprovalStatus[row.approval_status] || 0) + Number(row.total);
        stats.totalUsage += Number(row.total_usage || 0);
      });

      return stats;
    } catch (err) {
      throw new AppError('Failed to get game content statistics', 500);
    }
  }

  /**
   * Get trending content based on usage
   */
  async getTrendingContent(options: {
    gameKey?: string;
    limit?: number;
    timeframeHours?: number;
  }): Promise<GameContent[]> {
    try {
      const limit = options.limit || 10;
      const timeframe = options.timeframeHours || 24;

      let whereClause = `created_at >= NOW() - INTERVAL '${timeframe} hours'`;
      const params: unknown[] = [];

      if (options.gameKey) {
        whereClause += ` AND game_key = $1`;
        params.push(options.gameKey);
      }

      const result = await query<GameContent>(
        `SELECT * FROM game_content 
         WHERE ${whereClause}
         ORDER BY usage_count DESC 
         LIMIT $${params.length + 1}`,
        [...params, limit]
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get trending content', 500);
    }
  }
}

export const gameContentService = new GameContentService();
