import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { sanitizeText } from '../utils/sanitize';
import { hashPassword } from '../utils/hash';
import { sendEmail } from './email.service';
import { env } from '../config/env';

interface EarlyAccessCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string;
  ipAddress?: string;
}

export class EarlyAccessService {
  private generateTemporaryPassword(): string {
    const suffix = Math.floor(100 + Math.random() * 900);
    return `Flowkyn${suffix}`;
  }

  async create(data: EarlyAccessCreateInput) {
    const firstName = sanitizeText(data.firstName, 100);
    const lastName = sanitizeText(data.lastName, 100);
    const companyName = sanitizeText(data.companyName || '', 255);

    if (!firstName) {
      throw new AppError('First name is required', 400, 'VALIDATION_FAILED', [
        { field: 'firstName', message: 'First name cannot be empty' },
      ]);
    }
    if (!lastName) {
      throw new AppError('Last name is required', 400, 'VALIDATION_FAILED', [
        { field: 'lastName', message: 'Last name cannot be empty' },
      ]);
    }

    const [row] = await query(
      `INSERT INTO early_access_requests (
        id,
        first_name,
        last_name,
        email,
        company_name,
        ip_address,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [
        uuid(),
        firstName,
        lastName,
        data.email,
        companyName || null,
        data.ipAddress || null,
      ],
    );

    return row;
  }

  async list(page: number, limit: number) {
    const offset = (page - 1) * limit;

    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM early_access_requests',
      [],
    );
    const total = Number(countResult?.count || 0);

    const rows = await query(
      `SELECT id, first_name, last_name, email, company_name, ip_address, created_at,
              provisioned_user_id, account_provisioned_at, credentials_email_sent_at, last_email_error
       FROM early_access_requests
       ORDER BY created_at DESC
       OFFSET $1 LIMIT $2`,
      [offset, limit],
    );

    return {
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async provisionAccountAndSendCredentials(
    requestId: string,
    personalizedMessage = '',
    resetPasswordIfExists = true
  ) {
    const request = await queryOne<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      provisioned_user_id: string | null;
      account_provisioned_at: string | null;
      credentials_email_sent_at: string | null;
    }>(
      `SELECT id, first_name, last_name, email, provisioned_user_id, account_provisioned_at, credentials_email_sent_at
       FROM early_access_requests
       WHERE id = $1`,
      [requestId]
    );

    if (!request) {
      throw new AppError('Early access request not found', 404, 'NOT_FOUND');
    }

    const normalizedEmail = request.email.trim().toLowerCase();
    const fullName = `${request.first_name} ${request.last_name}`.trim() || normalizedEmail;
    const tempPassword = this.generateTemporaryPassword();
    const passwordHash = await hashPassword(tempPassword);

    if (request.account_provisioned_at && request.credentials_email_sent_at) {
      const linkedUser = request.provisioned_user_id
        ? await queryOne<{ id: string; email: string }>(
            `SELECT id, email FROM users WHERE id = $1`,
            [request.provisioned_user_id]
          )
        : await queryOne<{ id: string; email: string }>(
            `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)`,
            [normalizedEmail]
          );
      return {
        requestId: request.id,
        userId: linkedUser?.id || '',
        email: linkedUser?.email || normalizedEmail,
        createdNewAccount: false,
        accountProvisioned: true,
        emailSent: true,
        alreadyProcessed: true,
        passwordResetApplied: false,
        temporaryPassword: null,
        loginUrl: `${env.frontendUrl}/login`,
      };
    }

    const existingUser = await queryOne<{
      id: string;
      name: string;
      status: string;
      language: string | null;
    }>(
      `SELECT id, name, status, language
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    );

    let createdNewAccount = !existingUser;
    let user = existingUser
      ? await queryOne<{ id: string; name: string; email: string }>(
          resetPasswordIfExists
            ? `UPDATE users
               SET password_hash = $1,
                   status = 'active',
                   name = CASE WHEN name IS NULL OR TRIM(name) = '' THEN $2 ELSE name END,
                   updated_at = NOW()
               WHERE id = $3
               RETURNING id, name, email`
            : `UPDATE users
               SET status = 'active',
                   name = CASE WHEN name IS NULL OR TRIM(name) = '' THEN $1 ELSE name END,
                   updated_at = NOW()
               WHERE id = $2
               RETURNING id, name, email`,
          resetPasswordIfExists
            ? [passwordHash, fullName, existingUser.id]
            : [fullName, existingUser.id]
        )
      : null;

    // Handle concurrent admin sends safely: if insert collides, fallback to update path.
    if (!existingUser) {
      try {
        user = await queryOne<{ id: string; name: string; email: string }>(
          `INSERT INTO users (
            id, email, password_hash, name, language, status, onboarding_completed, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, 'en', 'active', false, NOW(), NOW())
          RETURNING id, name, email`,
          [uuid(), normalizedEmail, passwordHash, fullName]
        );
      } catch (err: any) {
        if (err?.code !== '23505') throw err;
        createdNewAccount = false;
        const collided = await queryOne<{ id: string; name: string; email: string }>(
          `SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1)`,
          [normalizedEmail]
        );
        if (!collided) {
          throw new AppError('Account collision detected but user was not found', 500, 'INTERNAL_ERROR');
        }
        user = await queryOne<{ id: string; name: string; email: string }>(
          resetPasswordIfExists
            ? `UPDATE users
               SET password_hash = $1,
                   status = 'active',
                   name = CASE WHEN name IS NULL OR TRIM(name) = '' THEN $2 ELSE name END,
                   updated_at = NOW()
               WHERE id = $3
               RETURNING id, name, email`
            : `UPDATE users
               SET status = 'active',
                   name = CASE WHEN name IS NULL OR TRIM(name) = '' THEN $1 ELSE name END,
                   updated_at = NOW()
               WHERE id = $2
               RETURNING id, name, email`,
          resetPasswordIfExists
            ? [passwordHash, fullName, collided.id]
            : [fullName, collided.id]
        );
      }
    }

    if (!user) {
      throw new AppError('Unable to create or update user account', 500, 'INTERNAL_ERROR');
    }

    await query(
      `UPDATE early_access_requests
       SET provisioned_user_id = $1,
           account_provisioned_at = COALESCE(account_provisioned_at, NOW()),
           updated_at = NOW()
       WHERE id = $2`,
      [user.id, request.id]
    );

    try {
      await sendEmail({
        to: user.email,
        type: 'early_access_credentials',
        data: {
          name: user.name || fullName,
          email: user.email,
          password: resetPasswordIfExists || createdNewAccount ? tempPassword : '',
          passwordResetApplied: resetPasswordIfExists || createdNewAccount,
          loginUrl: `${env.frontendUrl}/login`,
          personalizedMessage,
        },
        lang: existingUser?.language || 'en',
      });
      await query(
        `UPDATE early_access_requests
         SET credentials_email_sent_at = NOW(),
             last_email_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [request.id]
      );
    } catch (err: any) {
      console.error('[EarlyAccess] Account provisioned but email failed', {
        requestId,
        userId: user.id,
        email: user.email,
        error: err?.message || err,
      });
      await query(
        `UPDATE early_access_requests
         SET last_email_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [String(err?.message || 'UNKNOWN_EMAIL_ERROR').slice(0, 1500), request.id]
      );
      return {
        requestId: request.id,
        userId: user.id,
        email: user.email,
        createdNewAccount,
        accountProvisioned: true,
        emailSent: false,
        alreadyProcessed: false,
        passwordResetApplied: createdNewAccount || resetPasswordIfExists,
        temporaryPassword: createdNewAccount || resetPasswordIfExists ? tempPassword : null,
        loginUrl: `${env.frontendUrl}/login`,
      };
    }

    return {
      requestId: request.id,
      userId: user.id,
      email: user.email,
      createdNewAccount,
      accountProvisioned: true,
      emailSent: true,
      alreadyProcessed: false,
      passwordResetApplied: createdNewAccount || resetPasswordIfExists,
      temporaryPassword: createdNewAccount || resetPasswordIfExists ? tempPassword : null,
      loginUrl: `${env.frontendUrl}/login`,
    };
  }
}

