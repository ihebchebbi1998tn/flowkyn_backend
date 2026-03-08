import { query, queryOne } from '../config/database';
import { UserRow } from '../types';
import { AppError } from '../middleware/errorHandler';

export class UsersService {
  async getProfile(userId: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `SELECT id, email, name, avatar_url, language, status, created_at, updated_at FROM users WHERE id = $1`,
      [userId]
    );
    if (!user) throw new AppError('User not found', 404);
    return user;
  }

  async updateProfile(userId: string, data: { name?: string; language?: string }) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.language) {
      fields.push(`language = $${idx++}`);
      values.push(data.language);
    }

    if (fields.length === 0) throw new AppError('No fields to update', 400);

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, email, name, avatar_url, language, status, created_at, updated_at`,
      values
    );

    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, email, name, avatar_url, language, status, created_at, updated_at`,
      [avatarUrl, userId]
    );
    return user;
  }
}
