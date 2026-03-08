import cors from 'cors';

/**
 * CORS configuration.
 * Allow all origins to support preview environments, mobile apps, etc.
 */
export const corsOptions: cors.CorsOptions = {
  origin: true, // Allow all origins
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
