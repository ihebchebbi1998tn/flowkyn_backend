/**
 * Socket emitter utility — emit events from REST controllers to connected clients.
 * Import this anywhere you need to push real-time updates after a REST API action.
 */
import { getIO } from './index';

/**
 * Emit a notification to a specific user via the /notifications namespace.
 */
export function emitNotification(userId: string, notification: { id: string; type: string; data: any; created_at: string }) {
  try {
    const io = getIO();
    io.of('/notifications').to(`user:${userId}`).emit('notification:new', notification);
    io.of('/notifications').to(`user:${userId}`).emit('notification:count', { unread: -1 }); // -1 signals "increment"
  } catch {
    // Socket not initialized (e.g., in tests) — silently skip
  }
}

/**
 * Emit an event update to all users in an event room.
 */
export function emitEventUpdate(eventId: string, changes: Record<string, any>) {
  try {
    const io = getIO();
    io.of('/events').to(`event:${eventId}`).emit('event:updated', {
      eventId,
      changes,
    });
  } catch {
    // Socket not initialized — silently skip
  }
}

/**
 * Emit a notification to all users in an event room.
 */
export function emitEventNotification(eventId: string, type: string, payload: any) {
  try {
    const io = getIO();
    io.of('/events').to(`event:${eventId}`).emit('event:notification', { type, payload });
  } catch {
    // Socket not initialized — silently skip
  }
}

/**
 * Emit game state update to all players in a game session.
 */
export function emitGameUpdate(sessionId: string, event: string, data: any) {
  try {
    const io = getIO();
    io.of('/games').to(`game:${sessionId}`).emit(event as any, data);
  } catch {
    // Socket not initialized — silently skip
  }
}
