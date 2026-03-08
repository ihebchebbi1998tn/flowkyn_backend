import { Namespace, Socket } from 'socket.io';

/** Validate socket event data has required string fields */
function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

export function setupEventHandlers(eventsNs: Namespace) {
  eventsNs.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`[Events] User ${user.userId} connected`);

    // Join event room
    socket.on('event:join', (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;
      socket.join(`event:${data.eventId}`);
      socket.to(`event:${data.eventId}`).emit('event:user_joined', {
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Leave event room
    socket.on('event:leave', (data: { eventId: string }) => {
      if (!validateFields(data, ['eventId'])) return;
      socket.leave(`event:${data.eventId}`);
      socket.to(`event:${data.eventId}`).emit('event:user_left', {
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Chat message
    socket.on('chat:message', (data: { eventId: string; message: string; participantId: string }) => {
      if (!validateFields(data, ['eventId', 'message', 'participantId'])) return;
      // Limit message length
      const message = typeof data.message === 'string' ? data.message.slice(0, 2000) : '';
      eventsNs.to(`event:${data.eventId}`).emit('chat:message', {
        participantId: data.participantId,
        message,
        userId: user.userId,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Events] User ${user.userId} disconnected`);
    });
  });
}
