import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { buildPaginatedResponse } from '../utils/pagination';

export class AdminService {
  async getStats() {
    const stats = await queryOne<{
      total_users: string; total_organizations: string;
      total_events: string; total_game_sessions: string;
      active_users_30d: string; new_users_today: string; new_orgs_today: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM organizations) as total_organizations,
        (SELECT COUNT(*) FROM events) as total_events,
        (SELECT COUNT(*) FROM game_sessions) as total_game_sessions,
        (SELECT COUNT(*) FROM users WHERE updated_at > NOW() - INTERVAL '30 days') as active_users_30d,
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE) as new_users_today,
        (SELECT COUNT(*) FROM organizations WHERE created_at >= CURRENT_DATE) as new_orgs_today
    `);

    return {
      totalUsers: Number(stats?.total_users || 0),
      totalOrganizations: Number(stats?.total_organizations || 0),
      totalEvents: Number(stats?.total_events || 0),
      totalGameSessions: Number(stats?.total_game_sessions || 0),
      activeUsers30d: Number(stats?.active_users_30d || 0),
      newUsersToday: Number(stats?.new_users_today || 0),
      newOrgsToday: Number(stats?.new_orgs_today || 0),
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
      `SELECT u.id, u.name, u.email, u.status, u.language, u.avatar_url, u.onboarding_completed, u.created_at, u.updated_at
       FROM users u ${whereClause}
       ORDER BY u.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async getUserById(id: string) {
    const user = await queryOne(
      'SELECT id, name, email, status, language, avatar_url, onboarding_completed, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    return user;
  }

  async updateUser(id: string, data: Record<string, unknown>) {
    const allowedFields = ['name', 'status', 'language'];
    const fields = Object.keys(data).filter(k => allowedFields.includes(k));
    if (fields.length === 0) {
      throw new AppError(`No valid fields to update — allowed: ${allowedFields.join(', ')}`, 400, 'VALIDATION_FAILED');
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
    const values = fields.map(f => data[f]);

    const user = await queryOne(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING id, name, email, status, language, avatar_url, created_at, updated_at`,
      [id, ...values]
    );
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    return user;
  }

  async suspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  async unsuspendUser(id: string) {
    const result = await queryOne(
      "UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id",
      [id]
    );
    if (!result) throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  async deleteUser(id: string) {
    // Cascade: delete user sessions, email verifications, password resets, then user
    const { query: q, transaction: tx } = await import('../config/database');
    await tx(async (client) => {
      await client.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [id]);
      await client.query('DELETE FROM password_resets WHERE email = (SELECT email FROM users WHERE id = $1)', [id]);
      // Remove notifications
      await client.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      // Remove org memberships (cascaded participants will be handled by FK or manual cleanup)
      await client.query('DELETE FROM organization_members WHERE user_id = $1', [id]);
      // Delete user
      const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [id]);
      if (rowCount === 0) throw new AppError('User not found', 404, 'NOT_FOUND');
    });
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
              COALESCE(mc.member_count, 0) as member_count,
              COALESCE(ec.event_count, 0) as event_count,
              COALESCE(s.plan_name, 'free') as plan_name
       FROM organizations o
       LEFT JOIN users u ON o.owner_user_id = u.id
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       LEFT JOIN LATERAL (SELECT COUNT(*) as member_count FROM organization_members WHERE organization_id = o.id) mc ON true
       LEFT JOIN LATERAL (SELECT COUNT(*) as event_count FROM events WHERE organization_id = o.id) ec ON true
       ${whereClause}
       ORDER BY o.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[]
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  async deleteOrganization(id: string) {
    // Cascade: delete all org data before removing the organization
    const { transaction: tx } = await import('../config/database');
    await tx(async (client) => {
      // Get all events for this org
      const { rows: events } = await client.query('SELECT id FROM events WHERE organization_id = $1', [id]);
      const eventIds = events.map((e: any) => e.id);

      if (eventIds.length > 0) {
        // Delete game data for all events
        await client.query(`DELETE FROM game_actions WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM game_results WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM game_state_snapshots WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM game_rounds WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM game_sessions WHERE event_id = ANY($1)`, [eventIds]);

        // Delete event data
        await client.query(`DELETE FROM post_reactions WHERE post_id IN (SELECT id FROM activity_posts WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM activity_posts WHERE event_id = ANY($1)`, [eventIds]);
        await client.query(`DELETE FROM leaderboard_entries WHERE participant_id IN (SELECT id FROM participants WHERE event_id = ANY($1))`, [eventIds]);
        await client.query(`DELETE FROM event_messages WHERE event_id = ANY($1)`, [eventIds]);
        await client.query(`DELETE FROM event_invitations WHERE event_id = ANY($1)`, [eventIds]);
        await client.query(`DELETE FROM participants WHERE event_id = ANY($1)`, [eventIds]);
        await client.query(`DELETE FROM event_settings WHERE event_id = ANY($1)`, [eventIds]);
        await client.query(`DELETE FROM events WHERE organization_id = $1`, [id]);
      }

      // Delete org data
      await client.query('DELETE FROM organization_invitations WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM subscriptions WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM organization_members WHERE organization_id = $1', [id]);
      await client.query('DELETE FROM audit_logs WHERE organization_id = $1', [id]);

      const { rowCount } = await client.query('DELETE FROM organizations WHERE id = $1', [id]);
      if (rowCount === 0) throw new AppError('Organization not found', 404, 'NOT_FOUND');
    });
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
              COALESCE(ac.action_count, 0) as action_count
       FROM game_sessions gs
       LEFT JOIN game_types gt ON gs.game_type_id = gt.id
       LEFT JOIN events e ON gs.event_id = e.id
       LEFT JOIN organizations o ON e.organization_id = o.id
       LEFT JOIN LATERAL (SELECT COUNT(*) as action_count FROM game_actions WHERE game_session_id = gs.id) ac ON true
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
