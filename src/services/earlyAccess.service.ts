import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { sanitizeText } from '../utils/sanitize';

interface EarlyAccessCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string;
  ipAddress?: string;
}

export class EarlyAccessService {
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
      `SELECT id, first_name, last_name, email, company_name, ip_address, created_at
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
}

