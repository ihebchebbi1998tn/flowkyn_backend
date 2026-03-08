import { v4 as uuid } from 'uuid';
import { query } from '../config/database';

export class AuditLogsService {
  async create(orgId: string | null, userId: string, action: string, metadata: any) {
    const [log] = await query(
      `INSERT INTO audit_logs (id, organization_id, user_id, action, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [uuid(), orgId || null, userId, action, JSON.stringify(metadata)]
    );
    return log;
  }

  async listByOrg(orgId: string) {
    return query(
      `SELECT al.*, u.name as user_name
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.organization_id = $1 ORDER BY al.created_at DESC LIMIT 100`,
      [orgId]
    );
  }
}
