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

// ─── Presence tracking: Redis (if configured) with in-memory fallback ───
const presenceMap = new Map<string, Set<string>>(); // eventId -> Set<userId>
let presenceClient: any | null = null;
let rateClient: any | null = null;

export async function getPresence(roomId: string): Promise<string[]> {
  if (presenceClient) {
    try {
      const members = await presenceClient.sMembers(`presence:${roomId}`);
      return members || [];
    } catch {
      // Fallback to in-memory map if Redis fails
    }
  }
  return Array.from(presenceMap.get(roomId) || []);
}

export async function addPresence(roomId: string, userId: string) {
  if (presenceClient) {
    try {
      await presenceClient.sAdd(`presence:${roomId}`, userId);
      return;
    } catch {
      // Fallback to in-memory
    }
  }
  if (!presenceMap.has(roomId)) presenceMap.set(roomId, new Set());
  presenceMap.get(roomId)!.add(userId);
}

export async function removePresence(roomId: string, userId: string) {
  if (presenceClient) {
    try {
      await presenceClient.sRem(`presence:${roomId}`, userId);
      return;
    } catch {
      // Fallback to in-memory
    }
  }
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

export async function checkRateLimit(socket: any, eventName: string): Promise<boolean> {
  const config = RATE_LIMITS[eventName] || RATE_LIMITS.default;
  const now = Date.now();

  // Prefer Redis-based rate limiting when available
  if (rateClient && socket.user?.userId) {
    try {
      const key = `rate:${eventName}:${socket.user.userId}`;
      const windowMs = config.windowMs;
      const cutoff = now - windowMs;

      // Use a sorted set of timestamps
      const multi = rateClient.multi();
      multi.zRemRangeByScore(key, 0, cutoff);
      multi.zAdd(key, { score: now, value: String(now) });
      multi.zCard(key);
      multi.expire(key, Math.ceil(windowMs / 1000) + 1);
      const [, , countResult] = await multi.exec();
      const count = Number(countResult?.[1] ?? 0);

      if (count > config.max) {
        socket.emit('error', { message: 'Rate limit exceeded', code: 'RATE_LIMIT' });
        return false;
      }
      return true;
    } catch {
      // Fallback to in-memory limiter if Redis fails
    }
  }

  if (!rateLimitMap.has(socket)) rateLimitMap.set(socket, new Map());
  const socketLimits = rateLimitMap.get(socket)!;

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

  // Adapter-ready: if a Redis URL is configured, set up the Redis adapter
  // so that rooms and presence work across multiple Node.js instances.
  // This is entirely optional; if not configured, Socket.io will run in single-node mode.
  const redisUrl = process.env.REDIS_URL || process.env.SOCKET_REDIS_URL;
  if (redisUrl) {
    // Dynamically import to avoid hard dependency when Redis is not used.
    Promise.all([
      import('@socket.io/redis-adapter'),
      import('redis'),
    ])
      .then(([{ createAdapter }, redis]) => {
        const { createClient } = redis as any;
        const pubClient = createClient({ url: redisUrl });
        const subClient = pubClient.duplicate();

        // Separate client for presence + rate limiting
        presenceClient = createClient({ url: redisUrl });
        rateClient = presenceClient;

        return Promise.all([
          pubClient.connect(),
          subClient.connect(),
          presenceClient.connect(),
        ]).then(() => {
          io.adapter(createAdapter(pubClient, subClient));
          console.log('🔁 Socket.io Redis adapter attached (rooms + presence + rate limits)');
        });
      })
      .catch((err) => {
        console.warn('Failed to initialize Socket.io Redis adapter:', err?.message || err);
      });
  }

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
