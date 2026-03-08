import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOptions } from './config/cors';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { routes } from './routes';
import { env } from './config/env';

const app = express();

// ─── Global middleware ───
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'short'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Serve uploaded files statically ───
app.use('/uploads', express.static(env.uploadsDir, {
  maxAge: '1d',
  etag: true,
  dotfiles: 'deny', // Block access to dotfiles (.env, .tmp, etc.)
}));

// ─── Rate limiting ───
app.use('/v1/', apiRateLimiter);

// ─── Health check ───
app.get('/health', async (_req, res) => {
  const { checkConnection } = await import('./config/database');
  const dbOk = await checkConnection();
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'unreachable',
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
