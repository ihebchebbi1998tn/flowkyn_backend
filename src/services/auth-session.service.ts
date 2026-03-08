/**
 * @fileoverview Auth Session Service — handles JWT token creation,
 * refresh token rotation, and session lifecycle management.
 * 
 * Extracted from auth.service.ts for single-responsibility:
 * - Session creation (login)
 * - Token refresh with rotation
 * - Session cleanup and limits
 * - Logout (single session or all)
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { UserRow, UserSessionRow } from '../types';
import crypto from 'crypto';

/** Hash a refresh token before storing in DB (SHA-256) */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Maximum concurrent sessions per user before oldest is evicted */
const MAX_SESSIONS_PER_USER = 10;

export class AuthSessionService {
  /**
   * Create a new session for a user after successful authentication.
   * 
   * 1. Cleans expired sessions
   * 2. Enforces MAX_SESSIONS_PER_USER by evicting oldest
   * 3. Creates new session with hashed refresh token
   * 
   * @param user - Authenticated user row
   * @param ip - Client IP address
   * @param userAgent - Client user-agent string
   * @returns Access token, refresh token, and sanitized user object
   */
  async createSession(user: UserRow, ip: string, userAgent: string) {
    const payload = { userId: user.id, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const hashedRefreshToken = hashToken(refreshToken);

    await transaction(async (client) => {
      // Clean expired sessions
      await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND expires_at < NOW()', [user.id]);

      // Enforce session limit — delete oldest if at max
      const { rows: sessions } = await client.query(
        'SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY created_at ASC',
        [user.id]
      );
      if (sessions.length >= MAX_SESSIONS_PER_USER) {
        const toDelete = sessions.slice(0, sessions.length - MAX_SESSIONS_PER_USER + 1);
        await client.query(
          `DELETE FROM user_sessions WHERE id = ANY($1)`,
          [toDelete.map((s: any) => s.id)]
        );
      }

      await client.query(
        `INSERT INTO user_sessions (id, user_id, refresh_token, ip_address, user_agent, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days', NOW())`,
        [uuid(), user.id, hashedRefreshToken, ip, userAgent]
      );
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        language: user.language,
        status: user.status,
        onboarding_completed: user.onboarding_completed,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    };
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Implements token rotation — old refresh token is replaced with a new one.
   * 
   * @param refreshToken - The current refresh token
   * @returns New access token and rotated refresh token
   * @throws {AppError} 401 if token is invalid, expired, or not found
   */
  async refresh(refreshToken: string) {
    const { AppError } = await import('../middleware/errorHandler');

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError('Refresh token is invalid or expired', 401, 'AUTH_TOKEN_EXPIRED');
    }

    const hashedToken = hashToken(refreshToken);
    const session = await queryOne<UserSessionRow>(
      `SELECT * FROM user_sessions WHERE refresh_token = $1 AND expires_at > NOW()`,
      [hashedToken]
    );
    if (!session) throw new AppError('Refresh token not found or expired — please log in again', 401, 'AUTH_TOKEN_EXPIRED');

    // Rotate refresh token
    const newAccessToken = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefreshToken = signRefreshToken({ userId: payload.userId, email: payload.email });
    const newHashedRefresh = hashToken(newRefreshToken);

    await query(
      `UPDATE user_sessions SET refresh_token = $1, expires_at = NOW() + INTERVAL '7 days' WHERE id = $2`,
      [newHashedRefresh, session.id]
    );

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  }

  /**
   * Logout — destroy session(s).
   * If refreshToken is provided, only that session is destroyed.
   * Otherwise, all sessions for the user are destroyed.
   */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const hashedToken = hashToken(refreshToken);
      await query('DELETE FROM user_sessions WHERE user_id = $1 AND refresh_token = $2', [userId, hashedToken]);
    } else {
      await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    }
    return { message: 'Logged out successfully' };
  }
}
