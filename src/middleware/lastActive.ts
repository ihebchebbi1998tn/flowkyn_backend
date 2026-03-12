/**
 * Middleware to update user's last_active_at timestamp.
 * Throttled: updates at most once per 5 minutes per user to avoid write amplification.
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { query } from '../config/database';

const lastUpdatedMap = new Map<string, number>();
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export function trackLastActive(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user?.userId) return next();

  const userId = req.user.userId;
  const now = Date.now();
  const lastUpdated = lastUpdatedMap.get(userId) || 0;

  if (now - lastUpdated > THROTTLE_MS) {
    lastUpdatedMap.set(userId, now);
    // Fire-and-forget — don't block the request
    query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [userId]).catch(() => {});
  }

  next();
}
