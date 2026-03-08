import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { hashPassword, comparePassword } from '../utils/hash';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { UserRow, UserSessionRow } from '../types';
import { env } from '../config/env';
import crypto from 'crypto';

/** Hash a refresh token before storing in DB */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Maximum concurrent sessions per user */
const MAX_SESSIONS_PER_USER = 10;

export class AuthService {
  async register(email: string, password: string, name: string, lang?: string) {
    const passwordHash = await hashPassword(password);
    const userId = uuid();
    const token = crypto.randomBytes(32).toString('hex');
    const language = lang || 'en';

    try {
      await transaction(async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO users (id, email, password_hash, name, language, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
           ON CONFLICT (email) DO NOTHING`,
          [userId, email, passwordHash, name, language]
        );
        if (rowCount === 0) throw new AppError('Email already in use', 409);

        await client.query(
          `INSERT INTO email_verifications (id, user_id, token, expires_at, created_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours', NOW())`,
          [uuid(), userId, token]
        );
      });
    } catch (err: any) {
      if (err.code === '23505' && err.constraint?.includes('email')) {
        throw new AppError('Email already in use', 409);
      }
      throw err;
    }

    await sendEmail({
      to: email,
      type: 'verify_account',
      data: { link: `${env.frontendUrl}/verify?token=${token}`, name },
      lang,
    });

    return { message: 'Verification email sent' };
  }

  async verifyEmail(token: string) {
    const row = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM email_verifications WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (!row) throw new AppError('Invalid or expired verification token', 400);

    await transaction(async (client) => {
      await client.query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', ['active', row.user_id]);
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [row.user_id]);
    });

    return { message: 'Email verified successfully' };
  }

  async login(email: string, password: string, ip: string, userAgent: string) {
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) throw new AppError('Invalid credentials', 401);
    if (user.status === 'suspended') throw new AppError('Account suspended', 403);
    if (user.status !== 'active') throw new AppError('Account not verified', 403);

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const payload = { userId: user.id, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const hashedRefreshToken = hashToken(refreshToken);

    await transaction(async (client) => {
      // Clean expired sessions
      await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND expires_at < NOW()', [user.id]);

      // SECURITY: Enforce session limit — delete oldest if at max
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
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    };
  }

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const hashedToken = hashToken(refreshToken);

    const session = await queryOne<UserSessionRow>(
      `SELECT * FROM user_sessions WHERE refresh_token = $1 AND expires_at > NOW()`,
      [hashedToken]
    );
    if (!session) throw new AppError('Invalid or expired refresh token', 401);

    // SECURITY: Rotate refresh token on every refresh to limit stolen token impact
    const newAccessToken = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefreshToken = signRefreshToken({ userId: payload.userId, email: payload.email });
    const newHashedRefresh = hashToken(newRefreshToken);

    await query(
      `UPDATE user_sessions SET refresh_token = $1, expires_at = NOW() + INTERVAL '7 days' WHERE id = $2`,
      [newHashedRefresh, session.id]
    );

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const hashedToken = hashToken(refreshToken);
      await query('DELETE FROM user_sessions WHERE user_id = $1 AND refresh_token = $2', [userId, hashedToken]);
    } else {
      await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    }
    return { message: 'Logged out successfully' };
  }

  async getMe(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `SELECT id, email, name, avatar_url, language, status, created_at, updated_at FROM users WHERE id = $1`,
      [userId]
    );
    if (!user) throw new AppError('User not found', 404);
    return user;
  }

  async forgotPassword(email: string, lang?: string) {
    const user = await queryOne<UserRow>('SELECT id, name, language FROM users WHERE email = $1', [email]);
    // SECURITY: Always return same message to prevent email enumeration
    if (!user) return { message: 'If the email exists, a reset link has been sent' };

    await query('DELETE FROM password_resets WHERE email = $1', [email]);

    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO password_resets (id, email, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW())`,
      [uuid(), email, token]
    );

    await sendEmail({
      to: email,
      type: 'reset_password',
      data: { link: `${env.frontendUrl}/reset-password?token=${token}`, name: user.name },
      lang: lang || user.language || 'en',
    });

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await queryOne<{ email: string }>(
      `SELECT email FROM password_resets WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (!row) throw new AppError('Invalid or expired reset token', 400);

    const hash = await hashPassword(newPassword);
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2', [hash, row.email]);
      await client.query('DELETE FROM password_resets WHERE email = $1', [row.email]);
      // SECURITY: Invalidate ALL sessions on password reset (force re-login everywhere)
      await client.query(
        'DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)',
        [row.email]
      );
    });

    return { message: 'Password reset successfully' };
  }
}
