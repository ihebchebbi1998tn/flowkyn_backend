import { v4 as uuid } from 'uuid';
import { query } from '../config/database';

export class FilesService {
  async create(userId: string, url: string, fileType: string, size: number) {
    const [file] = await query(
      `INSERT INTO files (id, owner_user_id, url, file_type, size, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [uuid(), userId, url, fileType, size]
    );
    return file;
  }

  async listByUser(userId: string) {
    return query('SELECT * FROM files WHERE owner_user_id = $1 ORDER BY created_at DESC', [userId]);
  }
}
