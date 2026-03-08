import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { buildPaginatedResponse } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler';
import { sanitizeText } from '../utils/sanitize';

// BUG FIX: Whitelist allowed status values to prevent arbitrary status injection
const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'resolved', 'closed']);

export class ContactService {
  async create(data: { name: string; email: string; subject?: string; message: string; ipAddress?: string }) {
    // Sanitize user input
    const sanitizedName = sanitizeText(data.name, 100);
    const sanitizedSubject = sanitizeText(data.subject || '', 200);
    const sanitizedMessage = sanitizeText(data.message, 5000);

    if (sanitizedName.length === 0) throw new AppError('Name is required', 400);
    if (sanitizedMessage.length === 0) throw new AppError('Message is required', 400);

    const [submission] = await query(
      `INSERT INTO contact_submissions (id, name, email, subject, message, ip_address, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', NOW()) RETURNING *`,
      [uuid(), sanitizedName, data.email, sanitizedSubject, sanitizedMessage, data.ipAddress || null]
    );
    return submission;
  }

  async list(page: number, limit: number, status?: string) {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: unknown[] = [];

    if (status) {
      // BUG FIX: Validate status value
      if (!ALLOWED_STATUSES.has(status)) {
        throw new AppError(`Invalid status: ${status}`, 400);
      }
      whereClause = 'WHERE status = $1';
      params.push(status);
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM contact_submissions ${whereClause}`,
      params as any[]
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT * FROM contact_submissions ${whereClause}
       ORDER BY created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async getById(id: string) {
    const submission = await queryOne('SELECT * FROM contact_submissions WHERE id = $1', [id]);
    if (!submission) throw new AppError('Contact submission not found', 404);
    return submission;
  }

  async updateStatus(id: string, status: string) {
    // BUG FIX: Validate status value
    if (!ALLOWED_STATUSES.has(status)) {
      throw new AppError(`Invalid status: ${status}`, 400);
    }
    const row = await queryOne(
      `UPDATE contact_submissions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!row) throw new AppError('Contact submission not found', 404);
    return row;
  }

  async delete(id: string) {
    const result = await queryOne('DELETE FROM contact_submissions WHERE id = $1 RETURNING id', [id]);
    if (!result) throw new AppError('Contact submission not found', 404);
    return result;
  }
}
