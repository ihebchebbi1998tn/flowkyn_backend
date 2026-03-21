import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface ContentModerationItem {
  id: string;
  content_id: string;
  content_type: string;
  flagged_by: string;
  reason: string;
  description?: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  moderated_by?: string;
  moderation_notes?: string;
  moderated_at?: string;
  created_at: string;
  updated_at: string;
}

export class ContentModerationService {
  /**
   * Flag content for moderation
   */
  async flagContent(data: {
    contentId: string;
    contentType: string;
    reason: string;
    description?: string;
  }, flaggedBy: string): Promise<ContentModerationItem> {
    try {
      const result = await query<ContentModerationItem>(
        `INSERT INTO content_moderation_queue (content_id, content_type, flagged_by, reason, description, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [data.contentId, data.contentType, flaggedBy, data.reason, data.description || null]
      );
      return result[0];
    } catch (err) {
      throw new AppError('Failed to flag content for moderation', 500);
    }
  }

  /**
   * Get moderation queue items with filtering
   */
  async getModerationQueue(options: {
    status?: string;
    contentType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ContentModerationItem[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];
      let paramCount = 1;

      if (options.status) {
        whereClause += ` AND status = $${paramCount}`;
        params.push(options.status);
        paramCount++;
      }

      if (options.contentType) {
        whereClause += ` AND content_type = $${paramCount}`;
        params.push(options.contentType);
        paramCount++;
      }

      const [items, counts] = await Promise.all([
        query<ContentModerationItem>(
          `SELECT * FROM content_moderation_queue WHERE ${whereClause} ORDER BY created_at ASC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
          [...params, limit, offset]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) FROM content_moderation_queue WHERE ${whereClause}`,
          params
        ),
      ]);

      return { data: items, total: Number(counts[0]?.count || 0) };
    } catch (err) {
      throw new AppError('Failed to get moderation queue', 500);
    }
  }

  /**
   * Get a specific moderation item
   */
  async getModerationItem(itemId: string): Promise<ContentModerationItem | null> {
    try {
      const result = await query<ContentModerationItem>(
        'SELECT * FROM content_moderation_queue WHERE id = $1',
        [itemId]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get moderation item: ${itemId}`, 500);
    }
  }

  /**
   * Approve flagged content (move content back into use)
   */
  async approveContent(
    itemId: string,
    moderatedBy: string,
    notes?: string
  ): Promise<ContentModerationItem> {
    try {
      const item = await this.getModerationItem(itemId);
      if (!item) throw new AppError(`Moderation item not found: ${itemId}`, 404);

      const result = await query<ContentModerationItem>(
        `UPDATE content_moderation_queue 
         SET status = 'approved', moderated_by = $1, moderation_notes = $2, moderated_at = NOW()
         WHERE id = $3 
         RETURNING *`,
        [moderatedBy, notes || null, itemId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to approve moderation item: ${itemId}`, 500);
    }
  }

  /**
   * Reject flagged content (disable or remove content)
   */
  async rejectContent(
    itemId: string,
    moderatedBy: string,
    notes?: string
  ): Promise<ContentModerationItem> {
    try {
      const item = await this.getModerationItem(itemId);
      if (!item) throw new AppError(`Moderation item not found: ${itemId}`, 404);

      const result = await query<ContentModerationItem>(
        `UPDATE content_moderation_queue 
         SET status = 'rejected', moderated_by = $1, moderation_notes = $2, moderated_at = NOW()
         WHERE id = $3 
         RETURNING *`,
        [moderatedBy, notes || null, itemId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to reject moderation item: ${itemId}`, 500);
    }
  }

  /**
   * Archive a moderation item (no action needed)
   */
  async archiveItem(itemId: string): Promise<ContentModerationItem> {
    try {
      const item = await this.getModerationItem(itemId);
      if (!item) throw new AppError(`Moderation item not found: ${itemId}`, 404);

      const result = await query<ContentModerationItem>(
        `UPDATE content_moderation_queue 
         SET status = 'archived', moderated_at = NOW()
         WHERE id = $1 
         RETURNING *`,
        [itemId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to archive moderation item: ${itemId}`, 500);
    }
  }

  /**
   * Get moderation statistics
   */
  async getModerationStats(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    archived: number;
    averageProcessingTimeHours: number;
    byContentType: Record<string, number>;
    byReason: Record<string, number>;
  }> {
    try {
      const [statusCounts, processingTime, reasonCounts] = await Promise.all([
        query<any>(
          `SELECT status, COUNT(*) as count FROM content_moderation_queue GROUP BY status`
        ),
        query<any>(
          `SELECT AVG(EXTRACT(EPOCH FROM (moderated_at - created_at))/3600) as avg_hours 
           FROM content_moderation_queue WHERE moderated_at IS NOT NULL`
        ),
        query<any>(
          `SELECT reason, COUNT(*) as count FROM content_moderation_queue GROUP BY reason`
        ),
      ]);

      const stats = {
        pending: 0,
        approved: 0,
        rejected: 0,
        archived: 0,
        averageProcessingTimeHours: 0,
        byContentType: {} as Record<string, number>,
        byReason: {} as Record<string, number>,
      };

      statusCounts.forEach((row) => {
        const status = row.status as keyof typeof stats;
        if (status in stats) {
          (stats[status] as number) = Number(row.count);
        }
      });

      if (processingTime[0]?.avg_hours) {
        stats.averageProcessingTimeHours = Number(processingTime[0].avg_hours);
      }

      reasonCounts.forEach((row) => {
        stats.byReason[row.reason] = Number(row.count);
      });

      return stats;
    } catch (err) {
      throw new AppError('Failed to get moderation statistics', 500);
    }
  }

  /**
   * Get overdue moderation items (pending for more than X hours)
   */
  async getOverdueItems(hoursThreshold: number = 24): Promise<ContentModerationItem[]> {
    try {
      const result = await query<ContentModerationItem>(
        `SELECT * FROM content_moderation_queue 
         WHERE status = 'pending' 
         AND created_at <= NOW() - INTERVAL '${hoursThreshold} hours'
         ORDER BY created_at ASC`,
        []
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get overdue moderation items', 500);
    }
  }

  /**
   * Bulk approve items
   */
  async bulkApprove(itemIds: string[], moderatedBy: string): Promise<number> {
    try {
      if (itemIds.length === 0) return 0;

      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await query<any>(
        `UPDATE content_moderation_queue 
         SET status = 'approved', moderated_by = $${itemIds.length + 1}, moderated_at = NOW()
         WHERE id IN (${placeholders})
         RETURNING id`,
        [...itemIds, moderatedBy]
      );
      return result.length;
    } catch (err) {
      throw new AppError('Failed to bulk approve moderation items', 500);
    }
  }

  /**
   * Bulk reject items
   */
  async bulkReject(itemIds: string[], moderatedBy: string): Promise<number> {
    try {
      if (itemIds.length === 0) return 0;

      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await query<any>(
        `UPDATE content_moderation_queue 
         SET status = 'rejected', moderated_by = $${itemIds.length + 1}, moderated_at = NOW()
         WHERE id IN (${placeholders})
         RETURNING id`,
        [...itemIds, moderatedBy]
      );
      return result.length;
    } catch (err) {
      throw new AppError('Failed to bulk reject moderation items', 500);
    }
  }
}

export const contentModerationService = new ContentModerationService();
