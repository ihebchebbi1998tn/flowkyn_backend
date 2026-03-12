import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';

/**
 * Super-admin access control.
 * Only env-configured emails can access admin endpoints.
 */
/**
 * Super admin emails. Defaults include SUPER_ADMIN_DEFAULT_EMAIL env var, or support@flowkyn.com.
 * Add more via SUPER_ADMIN_EMAILS env var (comma-separated).
 */
const DEFAULT_SUPER_ADMINS = (process.env.SUPER_ADMIN_DEFAULT_EMAIL || 'support@flowkyn.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const SUPER_ADMIN_EMAILS = [
  ...DEFAULT_SUPER_ADMINS,
  ...(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
];

export async function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';

  if (!req.user) {
    res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_MISSING_TOKEN',
      statusCode: 401,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (SUPER_ADMIN_EMAILS.length === 0) {
    console.warn('⚠️ SUPER_ADMIN_EMAILS not configured — all admin access denied');
    res.status(403).json({
      error: 'Admin access is not configured on this server',
      code: 'SUPER_ADMIN_REQUIRED',
      statusCode: 403,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const userEmail = req.user.email.toLowerCase();
  if (!SUPER_ADMIN_EMAILS.includes(userEmail)) {
    res.status(403).json({
      error: 'Super-admin access required',
      code: 'SUPER_ADMIN_REQUIRED',
      statusCode: 403,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}
