import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { queryOne } from '../config/database';

/**
 * Super-admin access control.
 * 
 * SECURITY: Only uses env-configured emails. No DB fallback to prevent
 * privilege escalation via org creation.
 */
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export async function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // SECURITY: Only env-configured emails can be super admins.
  // The previous "flowkyn org owner" fallback was removed because any user
  // could create an org with slug "flowkyn" and gain admin access.
  if (SUPER_ADMIN_EMAILS.length === 0) {
    console.warn('⚠️ SUPER_ADMIN_EMAILS not configured — all admin access denied');
    res.status(403).json({ error: 'Admin access not configured' });
    return;
  }

  const userEmail = req.user.email.toLowerCase();
  if (!SUPER_ADMIN_EMAILS.includes(userEmail)) {
    res.status(403).json({ error: 'Forbidden: super-admin access required' });
    return;
  }

  next();
}
