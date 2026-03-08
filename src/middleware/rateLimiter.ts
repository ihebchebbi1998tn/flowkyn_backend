import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Build a structured rate-limit error response */
function rateLimitResponse(retryMessage: string) {
  return {
    error: retryMessage,
    code: 'RATE_LIMITED',
    statusCode: 429,
    timestamp: new Date().toISOString(),
  };
}

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many requests — please try again later'),
  skip: (req) => req.path === '/health',
});

/** Auth endpoints — stricter limits to prevent brute force */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many authentication attempts — please wait 15 minutes'),
});

/** File upload — very strict to prevent abuse */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many uploads — please wait a minute'),
});

/** Public endpoints (contact, etc.) — moderate limits */
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many requests — please wait a minute'),
});
