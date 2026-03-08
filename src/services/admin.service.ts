import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginate } from '../utils/pagination';

export class AdminService {
  async getStats() {
    const [users, orgs, events, sessions] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM organizations'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM events'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM game_sessions'),
    ]);

    const [activeUsers, newUsersToday, newOrgsToday] = await Promise.all([
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM users WHERE last_active_at > NOW() - INTERVAL '30 days'"
      ),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM users WHERE created_at >= CURRENT_DATE"
      ),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM organizations WHERE created_at >= CURRENT_DATE"
      ),
    ]);

    return {
      totalUsers: Number(users?.count || 0),
      totalOrganizations: Number(orgs?.count || 0),
      totalEvents: Number(events?.count || 0),
      totalGameSessions: Number(sessions?.count || 0),
      activeUsers30d: Number(activeUsers?.count || 0),
      newUsersToday: Number(newUsersToday?.count || 0),
      newOrgsToday: Number(newOrgsToday?.count || 0),
    };
  }

  async listUsers(page: number, limit: number, search?: string) {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: unknown[] = [];

    if (search) {
      whereClause = 'WHERE u.name ILIKE $1 OR u.email ILIKE $1';
      params.push(`%${search}%`);
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM users u ${whereClause}`,
      params
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.last_active_at
       FROM users u ${whereClause}
       ORDER BY u.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit]
    );

    return paginate(rows, total, page, limit);
  }

  async getUserById(id: string) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) throw new AppError(404, 'User not found');
    return user;
  }

  async updateUser(id: string, data: Record<string, unknown>) {
    const fields = Object.keys(data).filter(k => ['name', 'role', 'status'].includes(k));
    if (fields.length === 0) throw new AppError(400, 'No valid fields to update');

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
    const values = fields.map(f => data[f]);

    const user = await queryOne(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    if (!user) throw new AppError(404, 'User not found');
    return user;
  }

  async suspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError(404, 'User not found');
  }

  async unsuspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError(404, 'User not found');
  }

  async deleteUser(id: string) {
    const result = await queryOne('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result) throw new AppError(404, 'User not found');
  }

  async listOrganizations(page: number, limit: number, search?: string) {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: unknown[] = [];

    if (search) {
      whereClause = 'WHERE o.name ILIKE $1';
      params.push(`%${search}%`);
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM organizations o ${whereClause}`,
      params
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT o.*, u.name as owner_name,
              (SELECT COUNT(*) FROM organization_members WHERE organization_id = o.id) as member_count
       FROM organizations o
       LEFT JOIN users u ON o.owner_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit]
    );

    return paginate(rows, total, page, limit);
  }

  async deleteOrganization(id: string) {
    const result = await queryOne('DELETE FROM organizations WHERE id = $1 RETURNING id', [id]);
    if (!result) throw new AppError(404, 'Organization not found');
  }

  async listGameSessions(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const countResult = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM game_sessions');
    const total = Number(countResult?.count || 0);

    const rows = await query(
      `SELECT gs.*, gt.name as game_type_name, e.title as event_title, o.name as organization_name,
              (SELECT COUNT(*) FROM game_participants WHERE game_session_id = gs.id) as player_count
       FROM game_sessions gs
       LEFT JOIN game_types gt ON gs.game_type_id = gt.id
       LEFT JOIN events e ON gs.event_id = e.id
       LEFT JOIN organizations o ON e.organization_id = o.id
       ORDER BY gs.created_at DESC
       OFFSET $1 LIMIT $2`,
      [offset, limit]
    );

    return paginate(rows, total, page, limit);
  }

  async listAuditLogs(page: number, limit: number, filters?: { userId?: string; action?: string }) {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.userId) {
      params.push(filters.userId);
      conditions.push(`al.user_id = $${params.length}`);
    }
    if (filters?.action) {
      params.push(filters.action);
      conditions.push(`al.action = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs al ${whereClause}`,
      params
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT al.*, u.name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit]
    );

    return paginate(rows, total, page, limit);
  }
}
