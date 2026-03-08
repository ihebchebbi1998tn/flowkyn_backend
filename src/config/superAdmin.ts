import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { queryOne } from '../config/database';
import { env } from './env';

/**
 * List of super-admin email addresses (Flowkyn platform owners).
 * In production, store these in env or a dedicated DB table.
 */
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Middleware that restricts access to super-admin users only.
 * Must be used AFTER the `authenticate` middleware.
 * 
 * Checks if the authenticated user's email is in the super-admin list.
 */
export async function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userEmail = req.user.email.toLowerCase();

  // Check against env-configured super admin emails
  if (SUPER_ADMIN_EMAILS.length > 0 && SUPER_ADMIN_EMAILS.includes(userEmail)) {
    next();
    return;
  }

  // Fallback: check if user is org owner of the "flowkyn" organization
  // This allows promoting admins via the database without env changes
  const isFlowkynOwner = await queryOne(
    `SELECT 1 FROM organizations o 
     WHERE o.owner_user_id = $1 AND o.slug = 'flowkyn'
     LIMIT 1`,
    [req.user.userId]
  );

  if (isFlowkynOwner) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden: super-admin access required' });
}
