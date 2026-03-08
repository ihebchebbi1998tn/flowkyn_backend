import { Response, NextFunction } from 'express';
import { AuditLogsService } from '../services/auditLogs.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuthRequest } from '../types';
import { queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const auditLogsService = new AuditLogsService();
const orgsService = new OrganizationsService();

export class AuditLogsController {
  async listByOrg(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await queryOne<{ role_name: string }>(
        `SELECT r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
        [req.params.orgId, req.user!.userId]
      );
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      if (!['owner', 'admin'].includes(member.role_name)) {
        throw new AppError('Only owners and admins can view audit logs', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const logs = await auditLogsService.listByOrg(req.params.orgId);
      res.json(logs);
    } catch (err) { next(err); }
  }
}
