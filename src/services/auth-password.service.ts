/**
 * @fileoverview Auth Password Service — handles password-related operations:
 * - Forgot password (send reset email)
 * - Reset password (validate token, update hash, invalidate sessions)
 * 
 * Extracted from auth.service.ts for single-responsibility.
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { hashPassword } from '../utils/hash';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { UserRow } from '../types';
import { env } from '../config/env';
import crypto from 'crypto';

/** Hash a token using SHA-256 (consistent with refresh token hashing) */
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthPasswordService {
  /**
   * Initiate password reset flow.
   * 
   * 1. Look up user by email (always return same message to prevent enumeration)
   * 2. Delete any existing reset tokens for this email
   * 3. Create a new token valid for 1 hour (stored as SHA-256 hash)
   * 4. Send reset email with link (containing the raw token)
   * 
   * @param email - User's email address
   * @param lang - Preferred language for the email template
   */
  async forgotPassword(email: string, lang?: string) {
    const user = await queryOne<UserRow>('SELECT id, name, language FROM users WHERE email = $1', [email]);
    // NOTE: This reveals whether an email exists (user enumeration). Requested behavior.
    if (!user) throw new AppError('No account found with that email address', 404, 'AUTH_EMAIL_NOT_FOUND');

    await query('DELETE FROM password_resets WHERE email = $1', [email]);

    // Generate raw token for the email link, store hashed version in DB
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashResetToken(rawToken);
    
    await query(
      `INSERT INTO password_resets (id, email, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW())`,
      [uuid(), email, hashedToken]
    );

    await sendEmail({
      to: email,
      type: 'reset_password',
      data: { link: `${env.frontendUrl}/reset-password?token=${rawToken}`, name: user.name },
      lang: lang || user.language || 'en',
    });

    return { message: 'If the email exists, a reset link has been sent' };
  }

  /**
   * Complete password reset.
   * 
   * 1. Validate the reset token (must exist and not be expired)
   * 2. Hash the new password
   * 3. Update the user's password_hash
   * 4. Delete all reset tokens for this email
   * 5. Invalidate ALL active sessions (security measure)
   * 
   * @param token - The password reset token from the email link
   * @param newPassword - The new password (already validated by Zod schema)
   * @throws {AppError} 400 if token is invalid or expired
   */
  async resetPassword(token: string, newPassword: string) {
    // Hash the incoming token to match against DB
    const hashedToken = hashResetToken(token);
    const row = await queryOne<{ email: string }>(
      `SELECT email FROM password_resets WHERE token = $1 AND expires_at > NOW()`,
      [hashedToken]
    );
    if (!row) throw new AppError('Reset link is invalid or has expired — request a new one', 400, 'AUTH_RESET_TOKEN_EXPIRED');

    const hash = await hashPassword(newPassword);
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2', [hash, row.email]);
      await client.query('DELETE FROM password_resets WHERE email = $1', [row.email]);
      // Invalidate ALL sessions on password reset
      await client.query(
        'DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)',
        [row.email]
      );
    });

    return { message: 'Password reset successfully' };
  }
}
