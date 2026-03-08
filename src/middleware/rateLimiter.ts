import rateLimit from 'express-rate-limit';
import { Request } from 'express';
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

/** Skip rate limiting for health checks and test runner requests */
function shouldSkip(req: Request): boolean {
  if (req.path === '/health') return true;
  // Skip for automated test runners (identified by x-test-runner header)
  if (req.headers['x-test-runner'] === 'flowkyn-ui-tests') return true;
  return false;
}

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many requests — please try again later'),
  skip: shouldSkip,
});

/** Auth endpoints — stricter limits to prevent brute force */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many authentication attempts — please wait 15 minutes'),
  skip: shouldSkip,
});

/** File upload — very strict to prevent abuse */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many uploads — please wait a minute'),
  skip: shouldSkip,
});

/** Public endpoints (contact, etc.) — moderate limits */
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many requests — please wait a minute'),
  skip: shouldSkip,
});
