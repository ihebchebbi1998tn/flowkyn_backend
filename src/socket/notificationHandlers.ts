/**
 * Notifications namespace — real-time push notifications to connected users.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { query } from '../config/database';

export function setupNotificationHandlers(notificationsNs: Namespace) {
  notificationsNs.on('connection', async (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;
    console.log(`[Notifications] User ${user.userId} connected`);

    // Auto-join a personal room for targeted notifications
    socket.join(`user:${user.userId}`);

    // Send unread count on connect
    try {
      const [{ count }] = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [user.userId]
      );
      socket.emit('notification:count', { unread: parseInt(count) });
    } catch (err: any) {
      console.error(`[Notifications] Error fetching unread count:`, err.message);
    }

    socket.on('disconnect', () => {
      console.log(`[Notifications] User ${user.userId} disconnected`);
    });
  });
}
