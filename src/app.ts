import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { corsOptions } from './config/cors';
import { errorHandler } from './middleware/errorHandler';

import { requestId } from './middleware/requestId';
import { routes } from './routes';
import { env } from './config/env';
import { monitorMiddleware, monitorRoutes } from './monitor';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

const app = express();

// ─── Request ID tracking ───
app.use(requestId);

// ─── Security headers ───
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// ─── CORS — handle preflight explicitly, then apply to all requests ───
app.options('*', cors(corsOptions));
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

// ─── Swagger API Documentation (HTTP Basic Auth in production) ───
const docsAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (env.nodeEnv !== 'production') return next();
  if (!process.env.DOCS_USER || !process.env.DOCS_PASSWORD) {
    res.status(500).send('Docs auth is not configured');
    return;
  }
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      const expectedUser = process.env.DOCS_USER;
      const expectedPass = process.env.DOCS_PASSWORD;
      if (user === expectedUser && pass === expectedPass) return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Flowkyn API Docs"');
  res.status(401).send('Authentication required');
};
app.use('/docs', docsAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Flowkyn API Documentation',
  customfavIcon: '/favicon.ico',
}));
app.get('/docs.json', docsAuth, (_req, res) => res.json(swaggerSpec));

// ─── Serve uploaded files statically with caching ───
app.use('/uploads', express.static(env.uploadsDir, {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  dotfiles: 'deny',
  immutable: true,
}));

// ─── Global rate limiting ───
import { apiRateLimiter } from './middleware/rateLimiter';
import { trackLastActive } from './middleware/lastActive';
app.use('/v1', apiRateLimiter);
app.use('/v1', trackLastActive);

// ─── Health check (extended with pool stats) ───
// Lightweight liveness probe (no DB round-trip)
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Full readiness check (includes DB + pool stats)
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
    workers: {
      instanceId: process.env.PM2_INSTANCE_ID || '0',
      hasRedis: !!(process.env.REDIS_URL || process.env.SOCKET_REDIS_URL),
    },
  });
});

// ─── API routes ───
app.use('/v1', routes);

// ─── 404 handler ───
app.use((req, res) => {
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';
  const msg = `The requested resource was not found: ${req.method} ${req.path}`;
  res.status(404).json({
    error: msg,
    message: msg,
    code: 'NOT_FOUND',
    statusCode: 404,
    requestId,
    timestamp: new Date().toISOString(),
  });
});

// ─── Error handler ───
app.use(errorHandler);

export { app };
