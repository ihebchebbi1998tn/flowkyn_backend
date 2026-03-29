/**
 * @fileoverview Guest-aware authentication middleware.
 *
 * authenticateOrGuest accepts EITHER:
 * - A regular JWT (sets req.user)
 * - A guest token (sets req.guest with participantId, eventId, guestName)
 *
 * This allows guest participants to submit game actions and chat messages
 * without a full user account.
 */

import { Response, NextFunction } from 'express';
import { verifyAccessToken, verifyGuestToken } from '../utils/jwt';
import { AuthRequest } from '../types';

export function authenticateOrGuest(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization header with Bearer token is required',
      code: 'AUTH_MISSING_TOKEN',
      statusCode: 401,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  // Try regular user token first
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
    return;
  } catch {
    // Not a valid user token — try guest token
  }

  // Try guest token
  try {
    const guestPayload = verifyGuestToken(token);
    req.guest = guestPayload;
    next();
    return;
  } catch {
    // Neither token type worked
  }

  res.status(401).json({
    error: 'Invalid or expired token',
    code: 'AUTH_TOKEN_INVALID',
    statusCode: 401,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
