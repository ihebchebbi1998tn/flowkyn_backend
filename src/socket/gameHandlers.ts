import { Namespace, Socket } from 'socket.io';

/** Validate socket event data has required string fields */
function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

export function setupGameHandlers(gamesNs: Namespace) {
  gamesNs.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`[Games] User ${user.userId} connected`);

    // Join game session room
    socket.on('game:join', (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;
      socket.join(`game:${data.sessionId}`);
    });

    // Game start
    socket.on('game:start', (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;
      gamesNs.to(`game:${data.sessionId}`).emit('game:start', {
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });
    });

    // Round start
    socket.on('game:round_start', (data: { sessionId: string; roundNumber: number }) => {
      if (!validateFields(data, ['sessionId'])) return;
      if (typeof data.roundNumber !== 'number' || data.roundNumber < 1) return;
      gamesNs.to(`game:${data.sessionId}`).emit('game:round_start', {
        sessionId: data.sessionId,
        roundNumber: data.roundNumber,
        timestamp: new Date().toISOString(),
      });
    });

    // Player action
    socket.on('game:action', (data: { sessionId: string; action: any }) => {
      if (!validateFields(data, ['sessionId'])) return;
      gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
        userId: user.userId,
        action: data.action,
        timestamp: new Date().toISOString(),
      });
    });

    // Round end
    socket.on('game:round_end', (data: { sessionId: string; roundNumber: number }) => {
      if (!validateFields(data, ['sessionId'])) return;
      if (typeof data.roundNumber !== 'number' || data.roundNumber < 1) return;
      gamesNs.to(`game:${data.sessionId}`).emit('game:round_end', {
        sessionId: data.sessionId,
        roundNumber: data.roundNumber,
        timestamp: new Date().toISOString(),
      });
    });

    // Game end
    socket.on('game:end', (data: { sessionId: string; results: any }) => {
      if (!validateFields(data, ['sessionId'])) return;
      gamesNs.to(`game:${data.sessionId}`).emit('game:end', {
        sessionId: data.sessionId,
        results: data.results,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Games] User ${user.userId} disconnected`);
    });
  });
}
