import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { setupEventHandlers } from './eventHandlers';
import { setupGameHandlers } from './gameHandlers';

let io: Server;

export function initializeSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = verifyAccessToken(token);
      (socket as any).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Namespaces
  const eventsNs = io.of('/events');
  const gamesNs = io.of('/games');

  eventsNs.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      (socket as any).user = verifyAccessToken(token);
      next();
    } catch { next(new Error('Invalid token')); }
  });

  gamesNs.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      (socket as any).user = verifyAccessToken(token);
      next();
    } catch { next(new Error('Invalid token')); }
  });

  setupEventHandlers(eventsNs);
  setupGameHandlers(gamesNs);

  console.log('🔌 Socket.io initialized');
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
