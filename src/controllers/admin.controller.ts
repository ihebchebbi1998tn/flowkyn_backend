import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { query } from '../config/database';

const adminService = new AdminService();
const auditLogsService = new AuditLogsService();

export class AdminController {
  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await adminService.getStats();
      res.json(stats);
    } catch (err) { next(err); }
  }

  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20', search } = req.query;
      const result = await adminService.listUsers(Number(page), Number(limit), search as string);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.getUserById(req.params.id);
      res.json(user);
    } catch (err) { next(err); }
  }

  async updateUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await adminService.updateUser(req.params.id, req.body);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_UPDATE_USER', {
        targetUserId: req.params.id,
        changes: req.body,
      });
      res.json(user);
    } catch (err) { next(err); }
  }

  async suspendUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminService.suspendUser(req.params.id);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_SUSPEND_USER', {
        targetUserId: req.params.id,
      });
      res.json({ message: 'User suspended' });
    } catch (err) { next(err); }
  }

  async unsuspendUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminService.unsuspendUser(req.params.id);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_UNSUSPEND_USER', {
        targetUserId: req.params.id,
      });
      res.json({ message: 'User unsuspended' });
    } catch (err) { next(err); }
  }

  async deleteUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminService.deleteUser(req.params.id);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_DELETE_USER', {
        targetUserId: req.params.id,
      });
      res.status(204).end();
    } catch (err) { next(err); }
  }

  async listOrganizations(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20', search } = req.query;
      const result = await adminService.listOrganizations(Number(page), Number(limit), search as string);
      res.json(result);
    } catch (err) { next(err); }
  }

  async deleteOrganization(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminService.deleteOrganization(req.params.id);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_DELETE_ORG', {
        targetOrgId: req.params.id,
      });
      res.status(204).end();
    } catch (err) { next(err); }
  }

  async updateOrganizationStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const org = await adminService.updateOrganizationStatus(req.params.id, status);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_UPDATE_ORG_STATUS', {
        targetOrgId: req.params.id,
        newStatus: status,
      });
      res.json(org);
    } catch (err) { next(err); }
  }

  async listGameSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20' } = req.query;
      const result = await adminService.listGameSessions(Number(page), Number(limit));
      res.json(result);
    } catch (err) { next(err); }
  }

  async listAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '50', user_id, action } = req.query;
      const result = await adminService.listAuditLogs(Number(page), Number(limit), {
        userId: user_id as string,
        action: action as string,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  async banOrganization(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { orgId } = req.params;
      const { reason } = req.body;
      const org = await adminService.banOrganization(orgId, reason);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_BAN_ORGANIZATION', {
        organizationId: orgId,
        organizationName: org.name,
        reason,
      });
      res.json({ message: 'Organization banned successfully', organization: org });
    } catch (err) { next(err); }
  }

  async unbanOrganization(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { orgId } = req.params;
      const org = await adminService.unbanOrganization(orgId);
      await auditLogsService.create(null, req.user!.userId, 'ADMIN_UNBAN_ORGANIZATION', {
        organizationId: orgId,
        organizationName: org.name,
      });
      res.json({ message: 'Organization unbanned successfully', organization: org });
    } catch (err) { next(err); }
  }

  /** GET /admin/organizations/:orgId/pulse-survey — Get pulse survey results for an org */
  async getOrgPulseSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await query(
        `SELECT ps.*, u.name as submitted_by_name, u.email as submitted_by_email
         FROM onboarding_pulse_surveys ps
         JOIN users u ON u.id = ps.submitted_by_user_id
         WHERE ps.organization_id = $1
         ORDER BY ps.created_at DESC`,
        [req.params.orgId]
      );
      res.json(rows);
    } catch (err) { next(err); }
  }
}
