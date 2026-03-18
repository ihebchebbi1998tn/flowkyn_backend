/**
 * Rate Limiting Middleware — DISABLED
 * 
 * All rate limiting has been disabled. The following middleware exports
 * are no-op functions that simply pass through to the next middleware.
 */

/** No-op rate limiter middleware */
const noOpRateLimiter = (_req: any, _res: any, next: any) => {
  next();
};

/**
 * General API rate limiter — DISABLED (no-op)
 */
export const apiRateLimiter = noOpRateLimiter;

/**
 * Auth-specific rate limiter — DISABLED (no-op)
 */
export const authRateLimiter = noOpRateLimiter;

/**
 * Upload rate limiter — DISABLED (no-op)
 */
export const uploadRateLimiter = noOpRateLimiter;

/**
 * Public endpoint rate limiter — DISABLED (no-op)
 */
export const publicRateLimiter = noOpRateLimiter;

/**
 * Game debrief rate limiter — DISABLED (no-op)
 */
export const debriefRateLimiter = noOpRateLimiter;
