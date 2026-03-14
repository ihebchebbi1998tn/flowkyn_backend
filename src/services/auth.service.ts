/**
 * @fileoverview Auth Service — orchestrates authentication operations.
 * 
 * Delegates to specialized sub-services:
 * - AuthSessionService: Token creation, refresh, logout
 * - AuthPasswordService: Forgot/reset password flows
 * 
 * This service handles:
 * - User registration + email verification
 * - Login (credential validation + session creation)
 * - Get current user profile
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { hashPassword, comparePassword } from '../utils/hash';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { UserRow } from '../types';
import { env } from '../config/env';
import crypto from 'crypto';
import { AuthSessionService } from './auth-session.service';
import { AuthPasswordService } from './auth-password.service';

// Re-export sub-services for convenience
export { AuthSessionService } from './auth-session.service';
export { AuthPasswordService } from './auth-password.service';

export class AuthService {
  private sessions = new AuthSessionService();
  private passwords = new AuthPasswordService();

  /**
   * Register a new user account.
   * Creates user with 'pending' status, generates email verification token,
   * and sends verification email.
   * 
   * @throws {AppError} 409 if email is already in use
   */
  async register(email: string, password: string, name: string, lang?: string) {
    const passwordHash = await hashPassword(password);
    const userId = uuid();
    const token = crypto.randomBytes(32).toString('hex');
    // Generate a 6-digit OTP code for manual entry (maps to the same verification record)
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const language = lang || 'en';

    try {
      await transaction(async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO users (id, email, password_hash, name, language, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
           ON CONFLICT (email) DO NOTHING`,
          [userId, email, passwordHash, name, language]
        );
        if (rowCount === 0) throw new AppError('Email already in use', 409, 'AUTH_EMAIL_IN_USE');

        await client.query(
          `INSERT INTO email_verifications (id, user_id, token, otp_code, expires_at, created_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours', NOW())`,
          [uuid(), userId, token, otpCode]
        );
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.code === '23505' && err.constraint?.includes('email')) {
        throw new AppError('Email already in use', 409, 'AUTH_EMAIL_IN_USE');
      }
      throw err;
    }

    await sendEmail({
      to: email,
      type: 'verify_account',
      data: { link: `${env.frontendUrl}/verify?token=${token}`, name, otpCode },
      lang,
    });

    return { message: 'Verification email sent' };
  }

  /**
   * Verify email with token. Sets user status to 'active'.
   * @throws {AppError} 400 if token is invalid or expired
   */
  async verifyEmail(token: string) {
    // Support both full token (from email link) and 6-digit OTP code (from manual entry)
    const isOtp = /^\d{6}$/.test(token);
    const row = await queryOne<{ user_id: string }>(
      isOtp
        ? `SELECT user_id FROM email_verifications WHERE otp_code = $1 AND expires_at > NOW()`
        : `SELECT user_id FROM email_verifications WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    if (!row) throw new AppError('Invalid or expired verification token', 400, 'AUTH_VERIFICATION_EXPIRED');

    await transaction(async (client) => {
      await client.query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', ['active', row.user_id]);
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [row.user_id]);
    });

    return { message: 'Email verified successfully' };
  }

  /**
   * Login with email and password.
   * Validates credentials, checks account status, then delegates
   * to AuthSessionService for token creation.
   * 
   * @throws {AppError} 401 if credentials are invalid
   * @throws {AppError} 403 if account is suspended or unverified
   */
  async login(email: string, password: string, ip: string, userAgent: string) {
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
    if (user.status === 'suspended') throw new AppError('Your account has been suspended — contact support', 403, 'AUTH_ACCOUNT_SUSPENDED');
    if (user.status !== 'active') throw new AppError('Please verify your email before logging in', 403, 'AUTH_ACCOUNT_NOT_VERIFIED');

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');

    return this.sessions.createSession(user, ip, userAgent);
  }

  /** Refresh access token — delegates to AuthSessionService */
  async refresh(refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  /** Logout — delegates to AuthSessionService */
  async logout(userId: string, refreshToken?: string) {
    return this.sessions.logout(userId, refreshToken);
  }

  /** Get current user profile (including organization_id) */
  async getMe(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'> & { organization_id?: string }>(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.language, u.status, u.onboarding_completed, u.created_at, u.updated_at,
              om.organization_id
       FROM users u
       LEFT JOIN organization_members om ON om.user_id = u.id AND om.status = 'active'
       WHERE u.id = $1
       ORDER BY om.created_at DESC LIMIT 1`,
      [userId]
    );
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    return user;
  }

  /** Forgot password — delegates to AuthPasswordService */
  async forgotPassword(email: string, lang?: string) {
    return this.passwords.forgotPassword(email, lang);
  }

  /** Reset password — delegates to AuthPasswordService */
  async resetPassword(token: string, newPassword: string) {
    return this.passwords.resetPassword(token, newPassword);
  }
  /**
   * Resend verification email for a pending user.
   * Deletes any existing verification record and creates a new one.
   * Rate limited: max once per 2 minutes.
   * 
   * @throws {AppError} 404 if email not found
   * @throws {AppError} 400 if user is already verified
   * @throws {AppError} 429 if resend attempted within 2 minutes
   */
  async resendVerification(email: string, lang?: string) {
    const user = await queryOne<UserRow>('SELECT id, name, status, language FROM users WHERE email = $1', [email]);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    if (user.status === 'active') throw new AppError('Email is already verified', 400, 'AUTH_ALREADY_VERIFIED');
    if (user.status === 'suspended') throw new AppError('Account is suspended', 403, 'AUTH_ACCOUNT_SUSPENDED');

    // Check rate limit: max once per 2 minutes
    const recentVerification = await queryOne<{ created_at: string }>(
      `SELECT created_at FROM email_verifications 
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '2 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    if (recentVerification) {
      throw new AppError('Please wait before requesting a new verification code', 429, 'RATE_LIMITED');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));

    await transaction(async (client) => {
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [user.id]);
      await client.query(
        `INSERT INTO email_verifications (id, user_id, token, otp_code, expires_at, created_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours', NOW())`,
        [uuid(), user.id, token, otpCode]
      );
    });

    await sendEmail({
      to: email,
      type: 'verify_account',
      data: { link: `${env.frontendUrl}/verify?token=${token}`, name: user.name, otpCode },
      lang: lang || user.language || 'en',
    });

    return { message: 'Verification email sent' };
  }
}
