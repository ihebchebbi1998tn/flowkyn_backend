/**
 * Rate Limiting Middleware — protects against brute-force and abuse.
 * 
 * Configurable limits:
 * - apiRateLimiter: General API endpoints (200 req/15min)
 * - authRateLimiter: Auth endpoints (20 req/15min) — stricter for login/register
 * - uploadRateLimiter: File uploads (30 req/15min)
 * - publicRateLimiter: Public/unauthenticated endpoints (100 req/15min)
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Standardized rate limit error response */
const rateLimitHandler = (_req: any, res: any) => {
  const requestId = _req.headers['x-request-id'] || 'unknown';
  res.status(429).json({
    error: 'Too many requests — please slow down',
    code: 'RATE_LIMITED',
    statusCode: 429,
    requestId,
    timestamp: new Date().toISOString(),
  });
};

/**
 * General API rate limiter — 200 requests per 15 minutes per IP.
 * Applies to all authenticated API endpoints.
 */
export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs, // 15 minutes
  max: env.rateLimit.max, // 200 requests
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use X-Forwarded-For in production (behind proxy/load balancer)
    return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
  },
  handler: rateLimitHandler,
  skip: () => true, // Disabled by user request
});

/**
 * Auth-specific rate limiter — stricter limits for login/register.
 * 20 requests per 15 minutes to prevent credential stuffing.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
  },
  handler: rateLimitHandler,
  skip: () => env.nodeEnv === 'test',
});

/**
 * Upload rate limiter — 30 uploads per 15 minutes.
 * Protects against disk/bandwidth abuse.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
  },
  handler: rateLimitHandler,
  skip: () => env.nodeEnv === 'test',
});

/**
 * Public endpoint rate limiter — 100 requests per 15 minutes.
 * For unauthenticated endpoints like event lobbies and contact forms.
 */
export const publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
  },
  handler: rateLimitHandler,
  skip: () => env.nodeEnv === 'test',
});
