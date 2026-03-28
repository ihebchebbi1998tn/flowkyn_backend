import { query, queryOne } from '../config/database';
import { buildPaginatedResponse } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler';
import { sanitizeText } from '../utils/sanitize';

export type ActivityFeedbackCategory =
  | 'experience'
  | 'ui'
  | 'gameplay'
  | 'voice_audio'
  | 'other';

export type ActivityFeedbackSource =
  | 'end_clicked'
  | 'back_to_events'
  | 'activity_completed'
  | 'end_and_close';

const ALLOWED_CATEGORIES = new Set<ActivityFeedbackCategory>([
  'experience',
  'ui',
  'gameplay',
  'voice_audio',
  'other',
]);

const ALLOWED_SOURCES = new Set<ActivityFeedbackSource>([
  'end_clicked',
  'back_to_events',
  'activity_completed',
  'end_and_close',
]);

export interface ActivityFeedback {
  id: string;
  event_id: string;
  game_session_id: string | null;
  game_type_key: string;
  participant_id: string;
  reporter_name: string;
  reporter_avatar_url: string | null;
  rating: number;
  category: string | null;
  comment: string;
  source: string;
  ip_address: string | null;
  created_at: string;
}

export interface ActivityFeedbackStats {
  totalCount: number;
  avgRating: string | null;
  ratingCounts: Record<string, number>;
  categoryCounts: Array<{ category: string; count: number }>;
}

export class ActivityFeedbacksService {
  async create(data: {
    eventId: string;
    gameSessionId: string | null;
    gameTypeKey: string;
    participantId: string;
    reporterName: string;
    reporterAvatarUrl: string | null;
    rating: number;
    category: ActivityFeedbackCategory | null;
    comment: string;
    source: ActivityFeedbackSource;
    ipAddress: string | null;
  }): Promise<ActivityFeedback> {
    const sanitizedReporterName = sanitizeText(data.reporterName, 200);
    if (!sanitizedReporterName) {
      throw new AppError('Reporter name is required', 400, 'VALIDATION_FAILED', [
        { field: 'reporterName', message: 'Reporter name cannot be empty' },
      ]);
    }

    const sanitizedComment = sanitizeText(data.comment, 5000);
    if (!sanitizedComment) {
      throw new AppError('Comment is required', 400, 'VALIDATION_FAILED', [
        { field: 'comment', message: 'Comment cannot be empty' },
      ]);
    }

    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new AppError('Invalid rating', 400, 'VALIDATION_FAILED', [
        { field: 'rating', message: 'Rating must be between 1 and 5' },
      ]);
    }

    if (!data.gameTypeKey || typeof data.gameTypeKey !== 'string' || data.gameTypeKey.length > 50) {
      throw new AppError('Invalid game type', 400, 'VALIDATION_FAILED', [
        { field: 'gameTypeKey', message: 'Game type key is invalid' },
      ]);
    }

    if (data.category && !ALLOWED_CATEGORIES.has(data.category)) {
      throw new AppError('Invalid category', 400, 'VALIDATION_FAILED', [
        { field: 'category', message: 'Category is invalid' },
      ]);
    }

    if (!ALLOWED_SOURCES.has(data.source)) {
      throw new AppError('Invalid source', 400, 'VALIDATION_FAILED', [
        { field: 'source', message: 'Source is invalid' },
      ]);
    }

    const [row] = await query<ActivityFeedback>(
      `INSERT INTO activity_feedbacks
        (event_id, game_session_id, game_type_key, participant_id,
         reporter_name, reporter_avatar_url,
         rating, category, comment, source, ip_address, created_at)
       VALUES
        ($1, $2, $3, $4,
         $5, $6,
         $7, $8, $9, $10, $11, NOW())
       RETURNING *`,
      [
        data.eventId,
        data.gameSessionId,
        data.gameTypeKey,
        data.participantId,
        sanitizedReporterName,
        data.reporterAvatarUrl,
        rating,
        data.category,
        sanitizedComment,
        data.source,
        data.ipAddress,
      ],
    );

    return row;
  }

  async getById(id: string): Promise<ActivityFeedback | null> {
    const row = await queryOne<ActivityFeedback>('SELECT * FROM activity_feedbacks WHERE id = $1', [id]);
    return row;
  }

  async listAdvanced(options: {
    page: number;
    limit: number;
    eventId?: string;
    gameTypeKey?: string;
    rating?: number;
    category?: string;
    search?: string;
  }): Promise<{
    data: ActivityFeedback[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit, eventId, gameTypeKey, rating, category, search } = options;
    const offset = (page - 1) * limit;

    const whereConditions: string[] = [];
    const params: unknown[] = [];

    if (eventId) {
      whereConditions.push(`af.event_id = $${params.length + 1}`);
      params.push(eventId);
    }
    if (gameTypeKey) {
      whereConditions.push(`af.game_type_key = $${params.length + 1}`);
      params.push(gameTypeKey);
    }
    if (rating !== undefined && rating !== null) {
      whereConditions.push(`af.rating = $${params.length + 1}`);
      params.push(rating);
    }
    if (category) {
      whereConditions.push(`af.category = $${params.length + 1}`);
      params.push(category);
    }
    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push(
        `(af.reporter_name ILIKE $${params.length + 1} OR af.comment ILIKE $${params.length + 2} OR af.game_type_key ILIKE $${params.length + 3})`,
      );
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM activity_feedbacks af ${whereClause}`,
      params as any[],
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;

    const rows = await query<ActivityFeedback>(
      `SELECT af.*
       FROM activity_feedbacks af
       ${whereClause}
       ORDER BY af.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[],
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async getStats(): Promise<ActivityFeedbackStats> {
    const overall = await queryOne<{ totalCount: string; avgRating: string | null }>(
      `SELECT COUNT(*)::text as "totalCount",
              AVG(rating)::text as "avgRating"
       FROM activity_feedbacks`,
      [],
    );

    const ratingRows = await query<{ rating: string; count: string }>(
      `SELECT rating::text as rating, COUNT(*)::text as count
       FROM activity_feedbacks
       GROUP BY rating`,
      [],
    );

    const categoryRows = await query<{ category: string; count: string }>(
      `SELECT category, COUNT(*)::text as count
       FROM activity_feedbacks
       GROUP BY category
       ORDER BY COUNT(*) DESC`,
      [],
    );

    const ratingCounts: Record<string, number> = {};
    for (let i = 1; i <= 5; i++) ratingCounts[String(i)] = 0;
    for (const r of ratingRows) ratingCounts[r.rating] = Number(r.count || 0);

    return {
      totalCount: Number(overall?.totalCount || 0),
      avgRating: overall?.avgRating ?? null,
      ratingCounts,
      categoryCounts: categoryRows
        .filter(r => r.category !== null)
        .map(r => ({ category: r.category, count: Number(r.count || 0) })),
    };
  }
}

