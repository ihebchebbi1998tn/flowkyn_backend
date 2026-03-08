import { Response, NextFunction } from 'express';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { isAllowedImageType } from '../utils/upload';
import { query } from '../config/database';

const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

export class OrganizationsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const org = await orgsService.create(req.user!.userId, req.body.name);
      await audit.create(org.id, req.user!.userId, 'ORG_CREATE', { orgName: req.body.name });
      res.status(201).json(org);
    } catch (err) { next(err); }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const org = await orgsService.getById(req.params.orgId);
      res.json(org);
    } catch (err) { next(err); }
  }

  async listMembers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const members = await orgsService.listMembers(req.params.orgId);
      res.json(members);
    } catch (err) { next(err); }
  }

  async removeMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Verify requester is admin/owner of this org
      const requester = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!requester) { res.status(403).json({ error: 'Not a member' }); return; }

      const result = await query(
        `DELETE FROM organization_members WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [req.params.memberId, req.params.orgId]
      );
      if (result.length === 0) { res.status(404).json({ error: 'Member not found' }); return; }

      await audit.create(req.params.orgId, req.user!.userId, 'ORG_REMOVE_MEMBER', { memberId: req.params.memberId });
      res.status(204).end();
    } catch (err) { next(err); }
  }

  async inviteMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member of this organization' }); return; }
      const result = await orgsService.inviteMember(req.params.orgId, member.id, req.body.email, req.body.role_id, req.body.lang);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_INVITE_MEMBER', { invitedEmail: req.body.email, role: req.body.role_id });
      res.json(result);
    } catch (err) { next(err); }
  }

  async acceptInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await orgsService.acceptInvitation(req.user!.userId, req.body.token);
      await audit.create(null, req.user!.userId, 'ORG_ACCEPT_INVITATION', { token: '***' });
      res.json(result);
    } catch (err) { next(err); }
  }

  async uploadLogo(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400);
      if (!isAllowedImageType(file.mimetype)) throw new AppError('Only image files are allowed', 400);
      const org = await orgsService.uploadLogo(req.params.orgId, file);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPLOAD_LOGO', { mimetype: file.mimetype });
      res.json(org);
    } catch (err) { next(err); }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const org = await orgsService.updateOrg(req.params.orgId, req.body);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPDATE', { changes: Object.keys(req.body) });
      res.json(org);
    } catch (err) { next(err); }
  }
}
