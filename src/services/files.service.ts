import { v4 as uuid } from 'uuid';
import { query } from '../config/database';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';

export class FilesService {
  async create(userId: string, url: string, fileType: string, originalName: string, size: number) {
    const [file] = await query(
      `INSERT INTO files (id, owner_user_id, url, file_type, original_name, size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [uuid(), userId, url, fileType, originalName, size]
    );
    return file;
  }

  async listByUser(userId: string, pagination?: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination || {});
    const [data, [{ count }]] = await Promise.all([
      query('SELECT * FROM files WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM files WHERE owner_user_id = $1', [userId]),
    ]);
    return buildPaginatedResponse(data, parseInt(count), page, limit);
  }
}
