import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { NotificationRow } from '../types';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { emitNotification } from '../socket/emitter';
import { AppError } from '../middleware/errorHandler';

export class NotificationsService {
  async list(userId: string, pagination: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination);
    const [data, [{ count }]] = await Promise.all([
      query<NotificationRow>(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      ),
      query<{ count: string }>('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [userId]),
    ]);
    return buildPaginatedResponse(data, parseInt(count), page, limit);
  }

  async markRead(notificationId: string, userId: string) {
    const result = await queryOne(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [notificationId, userId]
    );
    if (!result) throw new AppError('Notification not found or does not belong to you', 404, 'NOT_FOUND');
    return result;
  }

  async markAllRead(userId: string) {
    await query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return { message: 'All notifications marked as read' };
  }

  async create(userId: string, type: string, data: any) {
    const id = uuid();
    const [notification] = await query(
      `INSERT INTO notifications (id, user_id, type, data, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [id, userId, type, JSON.stringify(data)]
    );

    emitNotification(userId, {
      id: notification.id,
      type: notification.type,
      data: notification.data,
      created_at: notification.created_at,
    });

    return notification;
  }
}
