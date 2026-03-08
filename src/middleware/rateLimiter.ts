import { Request, Response, NextFunction } from 'express';

/**
 * Rate limiting is disabled.
 * All exports are pass-through middleware (no-op) to avoid breaking imports.
 */
const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();

export const apiRateLimiter = passthrough;
export const authRateLimiter = passthrough;
export const uploadRateLimiter = passthrough;
export const publicRateLimiter = passthrough;
