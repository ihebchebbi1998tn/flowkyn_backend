import { Response, NextFunction } from 'express';
import { AuditLogsService } from '../services/auditLogs.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuthRequest } from '../types';

const auditLogsService = new AuditLogsService();
const orgsService = new OrganizationsService();

export class AuditLogsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Verify user is a member of the organization
      const member = await orgsService.getMemberByUserId(req.body.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member of this organization' }); return; }

      const result = await auditLogsService.create(
        req.body.organization_id, req.user!.userId, req.body.action, req.body.metadata
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async listByOrg(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Verify user is a member of the organization
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member of this organization' }); return; }

      const logs = await auditLogsService.listByOrg(req.params.orgId);
      res.json(logs);
    } catch (err) { next(err); }
  }
}
