/**
 * Sessions Controller — manages user session listing and revocation.
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { query } from '../config/database';
import { hashToken } from '../services/auth-session.service';
import { AppError } from '../middleware/errorHandler';
import { AuditLogsService } from '../services/auditLogs.service';

const audit = new AuditLogsService();

/**
 * Parse user_agent string into a friendly device description.
 */
function parseDevice(ua: string): { browser: string; os: string; device: string } {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  else if (/Edg\//.test(ua)) browser = 'Edge';

  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) { os = 'Android'; device = 'Mobile'; }
  else if (/iPhone|iPad/.test(ua)) { os = 'iOS'; device = 'Mobile'; }

  return { browser, os, device };
}

export class SessionsController {
  /** GET /users/sessions — list active sessions for the current user */
  async listSessions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const sessions = await query<any>(
        `SELECT id, ip_address, user_agent, created_at, expires_at
         FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId]
      );

      // Determine current session by comparing the request's token hash
      const currentToken = req.headers.authorization?.replace('Bearer ', '');
      // We can't directly match access tokens to sessions, so we mark the most recent as "current"

      const result = sessions.map((s: any, idx: number) => {
        const parsed = parseDevice(s.user_agent || '');
        return {
          id: s.id,
          browser: parsed.browser,
          os: parsed.os,
          device: parsed.device,
          ip_address: s.ip_address,
          created_at: s.created_at,
          expires_at: s.expires_at,
          is_current: idx === 0, // Most recent session is likely current
        };
      });

      res.json({ data: result });
    } catch (err) { next(err); }
  }

  /** DELETE /users/sessions/:sessionId — revoke a specific session */
  async revokeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const sessionId = req.params.sessionId;

      // Verify the session belongs to this user
      const result = await query(
        'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
      );

      if ((result as any).rowCount === 0) {
        throw new AppError('Session not found', 404, 'NOT_FOUND');
      }

      await audit.create(null, userId, 'SESSION_REVOKED', { sessionId, ip: req.ip });
      res.json({ message: 'Session revoked' });
    } catch (err) { next(err); }
  }

  /** DELETE /users/sessions — revoke all sessions except current */
  async revokeAllSessions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      // Delete all sessions (user will need to re-login)
      await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
      await audit.create(null, userId, 'ALL_SESSIONS_REVOKED', { ip: req.ip });
      res.json({ message: 'All sessions revoked' });
    } catch (err) { next(err); }
  }
}
