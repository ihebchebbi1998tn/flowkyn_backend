import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { corsOptions } from './config/cors';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { requestId } from './middleware/requestId';
import { routes } from './routes';
import { env } from './config/env';
import { monitorMiddleware, monitorRoutes } from './monitor';

const app = express();

// ─── Request ID tracking ───
app.use(requestId);

// ─── Security headers ───
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// ─── CORS ───
app.use(cors(corsOptions));

// ─── Response compression (gzip/brotli) ───
app.use(compression({
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ─── Logging ───
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'short'));

// ─── Body parsing with limits ───
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Monitor middleware (captures all requests) ───
app.use(monitorMiddleware);

// ─── Monitor dashboard ───
app.use('/monitor', monitorRoutes);

// ─── Serve uploaded files statically with caching ───
app.use('/uploads', express.static(env.uploadsDir, {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  dotfiles: 'deny',
  immutable: true,
}));

// ─── Rate limiting ───
app.use('/v1/', apiRateLimiter);

// ─── Health check (extended with pool stats) ───
app.get('/health', async (_req, res) => {
  const { checkConnection, getPoolStats } = await import('./config/database');
  const dbOk = await checkConnection();
  const poolStats = getPoolStats();
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'unreachable',
    pool: poolStats,
    uptime: process.uptime(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1048576),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1048576),
    },
  });
});

// ─── API routes ───
app.use('/v1', routes);

// ─── 404 handler ───
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Error handler ───
app.use(errorHandler);

export { app };
