import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { AuthRequest } from '../types';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';

  if (!authHeader) {
    res.status(401).json({
      error: 'Authorization header is required',
      code: 'AUTH_MISSING_TOKEN',
      statusCode: 401,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization header must use Bearer scheme',
      code: 'AUTH_TOKEN_INVALID',
      statusCode: 401,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    const isExpired = err.name === 'TokenExpiredError';
    res.status(401).json({
      error: isExpired ? 'Access token has expired' : 'Invalid access token',
      code: isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
      statusCode: 401,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
