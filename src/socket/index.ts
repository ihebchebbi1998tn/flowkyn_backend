/**
 * Socket.io initialization — core setup with namespaces, auth, CORS, and error handling.
 * Supports both regular JWT auth and guest tokens.
 */
import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { verifyAccessToken, verifyGuestToken } from '../utils/jwt';
import { setupEventHandlers } from './eventHandlers';
import { setupGameHandlers } from './gameHandlers';
import { setupNotificationHandlers } from './notificationHandlers';
import { AuthenticatedSocket } from './types';

let io: Server;

// ─── In-memory presence tracker ───
const presenceMap = new Map<string, Set<string>>(); // eventId -> Set<userId>

export function getPresence(roomId: string): string[] {
  return Array.from(presenceMap.get(roomId) || []);
}

export function addPresence(roomId: string, userId: string) {
  if (!presenceMap.has(roomId)) presenceMap.set(roomId, new Set());
  presenceMap.get(roomId)!.add(userId);
}

export function removePresence(roomId: string, userId: string) {
  presenceMap.get(roomId)?.delete(userId);
  if (presenceMap.get(roomId)?.size === 0) presenceMap.delete(roomId);
}

// ─── Shared auth middleware (supports both user JWTs and guest tokens) ───
function socketAuthMiddleware(socket: any, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
  if (!token) {
    return next(new Error('Authentication required'));
  }

  // Try regular user token first
  try {
    const payload = verifyAccessToken(token);
    socket.user = payload;
    socket.isGuest = false;
    next();
    return;
  } catch {
    // Not a user token — try guest
  }

  // Try guest token
  try {
    const guestPayload = verifyGuestToken(token);
    // Set user-like shape so handlers can work uniformly
    socket.user = {
      userId: `guest:${guestPayload.participantId}`,
      email: '',
    };
    socket.guestPayload = guestPayload;
    socket.isGuest = true;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

// ─── Socket rate limiter (per socket, per event) ───
const rateLimitMap = new WeakMap<any, Map<string, number[]>>();
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  'chat:message': { max: 30, windowMs: 10000 },  // 30 messages per 10s
  'chat:typing': { max: 10, windowMs: 5000 },     // 10 typing events per 5s
  'game:action': { max: 60, windowMs: 10000 },    // 60 actions per 10s
  default: { max: 50, windowMs: 10000 },
};

export function checkRateLimit(socket: any, eventName: string): boolean {
  if (!rateLimitMap.has(socket)) rateLimitMap.set(socket, new Map());
  const socketLimits = rateLimitMap.get(socket)!;

  const config = RATE_LIMITS[eventName] || RATE_LIMITS.default;
  const now = Date.now();

  if (!socketLimits.has(eventName)) socketLimits.set(eventName, []);
  const timestamps = socketLimits.get(eventName)!;

  // Remove timestamps outside window
  const cutoff = now - config.windowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= config.max) {
    socket.emit('error', { message: 'Rate limit exceeded', code: 'RATE_LIMIT' });
    return false;
  }

  timestamps.push(now);
  return true;
}

// ─── Initialize ───
export function initializeSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: true, // Allow all origins (matches HTTP CORS config)
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1MB max payload
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: false,
    },
  });

  // Default namespace auth
  io.use(socketAuthMiddleware);

  // ─── Events namespace (/events) ───
  const eventsNs = io.of('/events');
  eventsNs.use(socketAuthMiddleware);
  setupEventHandlers(eventsNs);

  // ─── Games namespace (/games) ───
  const gamesNs = io.of('/games');
  gamesNs.use(socketAuthMiddleware);
  setupGameHandlers(gamesNs);

  // ─── Notifications namespace (/notifications) ───
  const notificationsNs = io.of('/notifications');
  notificationsNs.use(socketAuthMiddleware);
  setupNotificationHandlers(notificationsNs);

  // ─── Default namespace — connection status only ───
  io.on('connection', (socket) => {
    const user = (socket as any).user;
    console.log(`[Socket] User ${user.userId} connected (default ns)`);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User ${user.userId} disconnected: ${reason}`);
    });
  });

  console.log('🔌 Socket.io initialized with /events, /games, /notifications namespaces');
}

/**
 * Get the Socket.io server instance (for emitting from REST controllers).
 */
export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized — call initializeSocket first');
  return io;
}
