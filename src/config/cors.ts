import cors from 'cors';
import { env } from './env';

/**
 * CORS configuration.
 * 
 * In production, set CORS_ORIGINS env var to a comma-separated list of allowed origins:
 *   CORS_ORIGINS=https://flowkyn.com,https://app.flowkyn.com,https://admin.flowkyn.com
 * 
 * In development, all origins are allowed.
 */
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

export const corsOptions: cors.CorsOptions = {
  origin: allowedOrigins.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      }
    : true, // Allow all origins in dev (with credentials support)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
};
