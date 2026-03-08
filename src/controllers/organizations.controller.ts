import { Response, NextFunction } from 'express';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { isAllowedImageType } from '../utils/upload';
import { query, queryOne } from '../config/database';

const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

/** Check if a member has admin-level role (owner or admin) */
async function requireOrgAdmin(orgId: string, userId: string): Promise<{ id: string; role_name: string }> {
  const member = await queryOne<{ id: string; role_name: string }>(
    `SELECT om.id, r.name as role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [orgId, userId]
  );
  if (!member) throw new AppError('Not a member of this organization', 403);
  if (!['owner', 'admin'].includes(member.role_name)) {
    throw new AppError('Insufficient permissions — admin role required', 403);
  }
  return member;
}

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
      // Any member can view their org
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const org = await orgsService.getById(req.params.orgId);
      res.json(org);
    } catch (err) { next(err); }
  }

  async listMembers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Any member can list members
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const members = await orgsService.listMembers(req.params.orgId);
      res.json(members);
    } catch (err) { next(err); }
  }

  async removeMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // SECURITY: Only owner/admin can remove members
      const requester = await requireOrgAdmin(req.params.orgId, req.user!.userId);

      // SECURITY: Cannot remove the owner
      const targetMember = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.id = $1 AND om.organization_id = $2`,
        [req.params.memberId, req.params.orgId]
      );
      if (!targetMember) { res.status(404).json({ error: 'Member not found' }); return; }
      if (targetMember.role_name === 'owner') {
        res.status(403).json({ error: 'Cannot remove the organization owner' });
        return;
      }
      // SECURITY: Admins cannot remove other admins (only owner can)
      if (targetMember.role_name === 'admin' && requester.role_name !== 'owner') {
        res.status(403).json({ error: 'Only the owner can remove admins' });
        return;
      }

      await query(
        `DELETE FROM organization_members WHERE id = $1 AND organization_id = $2`,
        [req.params.memberId, req.params.orgId]
      );

      await audit.create(req.params.orgId, req.user!.userId, 'ORG_REMOVE_MEMBER', { memberId: req.params.memberId });
      res.status(204).end();
    } catch (err) { next(err); }
  }

  async inviteMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // SECURITY: Only owner/admin can invite
      const member = await requireOrgAdmin(req.params.orgId, req.user!.userId);
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
      // SECURITY: Only owner/admin can upload logo
      await requireOrgAdmin(req.params.orgId, req.user!.userId);
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
      // SECURITY: Only owner/admin can update org
      await requireOrgAdmin(req.params.orgId, req.user!.userId);
      const org = await orgsService.updateOrg(req.params.orgId, req.body);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPDATE', { changes: Object.keys(req.body) });
      res.json(org);
    } catch (err) { next(err); }
  }
}
