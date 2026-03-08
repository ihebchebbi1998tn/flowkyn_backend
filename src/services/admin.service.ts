import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { buildPaginatedResponse } from '../utils/pagination';

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
        "SELECT COUNT(*) as count FROM users WHERE updated_at > NOW() - INTERVAL '30 days'"
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
      params as any[]
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT u.id, u.name, u.email, u.status, u.language, u.avatar_url, u.created_at, u.updated_at
       FROM users u ${whereClause}
       ORDER BY u.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async getUserById(id: string) {
    const user = await queryOne(
      'SELECT id, name, email, status, language, avatar_url, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    if (!user) throw new AppError('User not found', 404);
    return user;
  }

  async updateUser(id: string, data: Record<string, unknown>) {
    const allowedFields = ['name', 'status', 'language'];
    const fields = Object.keys(data).filter(k => allowedFields.includes(k));
    if (fields.length === 0) throw new AppError('No valid fields to update', 400);

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
    const values = fields.map(f => data[f]);

    const user = await queryOne(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING id, name, email, status, language, avatar_url, created_at, updated_at`,
      [id, ...values]
    );
    if (!user) throw new AppError('User not found', 404);
    return user;
  }

  async suspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError('User not found', 404);
  }

  async unsuspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError('User not found', 404);
  }

  async deleteUser(id: string) {
    const result = await queryOne('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result) throw new AppError('User not found', 404);
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
      params as any[]
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.owner_user_id, o.created_at, o.updated_at,
              u.name as owner_name,
              (SELECT COUNT(*) FROM organization_members WHERE organization_id = o.id) as member_count,
              (SELECT COUNT(*) FROM events WHERE organization_id = o.id) as event_count,
              COALESCE(s.plan_name, 'free') as plan_name
       FROM organizations o
       LEFT JOIN users u ON o.owner_user_id = u.id
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       ${whereClause}
       ORDER BY o.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async deleteOrganization(id: string) {
    const result = await queryOne('DELETE FROM organizations WHERE id = $1 RETURNING id', [id]);
    if (!result) throw new AppError('Organization not found', 404);
  }

  async listGameSessions(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const countResult = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM game_sessions');
    const total = Number(countResult?.count || 0);

    const rows = await query(
      `SELECT gs.id, gs.status, gs.current_round, gs.started_at, gs.ended_at,
              gt.name as game_type_name, gt.key as game_type_key,
              e.title as event_title,
              o.name as organization_name,
              (SELECT COUNT(*) FROM game_actions WHERE game_session_id = gs.id) as action_count
       FROM game_sessions gs
       LEFT JOIN game_types gt ON gs.game_type_id = gt.id
       LEFT JOIN events e ON gs.event_id = e.id
       LEFT JOIN organizations o ON e.organization_id = o.id
       ORDER BY gs.started_at DESC NULLS LAST
       OFFSET $1 LIMIT $2`,
      [offset, limit]
    );

    return buildPaginatedResponse(rows, total, page, limit);
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
      params as any[]
    );
    const total = Number(countResult?.count || 0);

    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query(
      `SELECT al.id, al.action, al.metadata, al.created_at,
              al.user_id, u.name as user_name, u.email as user_email,
              al.organization_id, o.name as organization_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN organizations o ON al.organization_id = o.id
       ${whereClause}
       ORDER BY al.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }
}
