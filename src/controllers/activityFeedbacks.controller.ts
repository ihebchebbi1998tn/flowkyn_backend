import { Response, NextFunction } from 'express';
import { ActivityFeedbacksService, type ActivityFeedbackCategory, type ActivityFeedbackSource } from '../services/activityFeedbacks.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { queryOne } from '../config/database';
import { verifyParticipantOwnership } from '../utils/authHelpers';

const activityFeedbackService = new ActivityFeedbacksService();
const auditService = new AuditLogsService();

export class ActivityFeedbacksController {
  /**
   * Create end-of-activity feedback (user + guest supported).
   */
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        eventId,
        gameSessionId = null,
        gameTypeKey,
        participantId,
        rating,
        category = null,
        comment,
        source = 'end_clicked',
      } = req.body ?? {};

      if (!eventId || !participantId || !gameTypeKey) {
        throw new AppError('Missing required fields', 400, 'VALIDATION_FAILED', [
          { field: 'eventId', message: 'eventId is required' },
          { field: 'participantId', message: 'participantId is required' },
          { field: 'gameTypeKey', message: 'gameTypeKey is required' },
        ]);
      }

      if (rating === undefined || rating === null) {
        throw new AppError('Rating is required', 400, 'VALIDATION_FAILED', [
          { field: 'rating', message: 'rating is required' },
        ]);
      }

      if (!comment || typeof comment !== 'string') {
        throw new AppError('Comment is required', 400, 'VALIDATION_FAILED', [
          { field: 'comment', message: 'comment is required' },
        ]);
      }

      // Ownership checks (guest token participantId OR authenticated org member participant)
      await verifyParticipantOwnership(String(participantId), req);

      // Verify participant belongs to the event
      const participantRow = await queryOne<{ reporter_name: string; reporter_avatar_url: string | null }>(
        `SELECT
           COALESCE(ep.display_name, p.guest_name, u.name) as reporter_name,
           COALESCE(ep.avatar_url, p.guest_avatar, u.avatar_url) as reporter_avatar_url
         FROM participants p
         LEFT JOIN event_profiles ep
           ON ep.participant_id = p.id AND ep.event_id = p.event_id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE p.id = $1 AND p.event_id = $2 AND p.left_at IS NULL`,
        [participantId, eventId],
      );

      if (!participantRow) {
        throw new AppError('Participant not found in event', 404, 'NOT_FOUND');
      }

      // Validate game session belongs to event (if provided)
      if (gameSessionId) {
        const sessionRow = await queryOne<{ id: string }>(
          `SELECT id FROM game_sessions WHERE id = $1 AND event_id = $2`,
          [gameSessionId, eventId],
        );
        if (!sessionRow) {
          throw new AppError('Game session not found for this event', 404, 'NOT_FOUND');
        }
      }

      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || null;

      const created = await activityFeedbackService.create({
        eventId,
        gameSessionId,
        gameTypeKey,
        participantId: String(participantId),
        reporterName: participantRow.reporter_name,
        reporterAvatarUrl: participantRow.reporter_avatar_url,
        rating: Number(rating),
        category: (category ? String(category) : null) as ActivityFeedbackCategory | null,
        comment,
        source: (source ? String(source) : 'end_clicked') as ActivityFeedbackSource,
        ipAddress,
      });

      await auditService.create(null, req.user?.userId || null, 'ACTIVITY_FEEDBACK_CREATE', {
        feedbackId: created.id,
        eventId,
        gameSessionId,
        gameTypeKey,
        participantId,
        rating: created.rating,
        category: created.category,
        source: created.source,
      });

      res.status(201).json({
        message: 'Feedback submitted successfully',
        data: created,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin stats.
   */
  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await activityFeedbackService.getStats();
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin list with filters.
   */
  async listAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        page = '1',
        limit = '20',
        eventId,
        gameTypeKey,
        rating,
        category,
        search,
      } = req.query;

      const data = await activityFeedbackService.listAdvanced({
        page: Number(page),
        limit: Number(limit),
        eventId: eventId ? String(eventId) : undefined,
        gameTypeKey: gameTypeKey ? String(gameTypeKey) : undefined,
        rating: rating !== undefined ? Number(rating) : undefined,
        category: category ? String(category) : undefined,
        search: search ? String(search) : undefined,
      });

      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin detail.
   */
  async getByIdAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const fb = await activityFeedbackService.getById(id);
      if (!fb) throw new AppError('Feedback not found', 404, 'NOT_FOUND');
      res.json({ data: fb });
    } catch (err) {
      next(err);
    }
  }
}

