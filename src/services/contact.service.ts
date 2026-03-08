import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { buildPaginatedResponse } from '../utils/pagination';

export class ContactService {
  async create(data: { name: string; email: string; subject?: string; message: string; ipAddress?: string }) {
    const [submission] = await query(
      `INSERT INTO contact_submissions (id, name, email, subject, message, ip_address, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', NOW()) RETURNING *`,
      [uuid(), data.name, data.email, data.subject || '', data.message, data.ipAddress || null]
    );
    return submission;
  }

  async list(page: number, limit: number, status?: string) {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: unknown[] = [];

    if (status) {
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
    return queryOne('SELECT * FROM contact_submissions WHERE id = $1', [id]);
  }

  async updateStatus(id: string, status: string) {
    const row = await queryOne(
      `UPDATE contact_submissions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return row;
  }

  async delete(id: string) {
    return queryOne('DELETE FROM contact_submissions WHERE id = $1 RETURNING id', [id]);
  }
}
