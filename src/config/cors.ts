import cors from 'cors';

/**
 * CORS configuration — allow ALL origins without restriction.
 * No origin checks: supports app.flowkyn.com, localhost, preview deployments, mobile apps.
 */
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Always allow — no origin validation
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-ID',
    'X-Test-Runner',
    'X-No-Compression',
  ],
  exposedHeaders: ['X-Request-ID'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
