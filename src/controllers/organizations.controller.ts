import { Response, NextFunction } from 'express';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { isAllowedImageType } from '../utils/upload';
import { query, queryOne } from '../config/database';
import { requireAdminRole, requireOrgMember } from '../utils/authHelpers';

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
  if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
  if (!['owner', 'admin'].includes(member.role_name)) {
    throw new AppError('Admin or owner role required for this action', 403, 'INSUFFICIENT_PERMISSIONS');
  }
  return member;
}

export class OrganizationsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const org = await orgsService.create(req.user!.userId, req.body);
      await audit.create(org.id, req.user!.userId, 'ORG_CREATE', { orgName: req.body.name });
      res.status(201).json(org);
    } catch (err) { next(err); }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      const org = await orgsService.getById(req.params.orgId);
      res.json(org);
    } catch (err) { next(err); }
  }

  async listMembers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      const members = await orgsService.listMembers(req.params.orgId);
      res.json(members);
    } catch (err) { next(err); }
  }

  async listInvitations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      const invites = await orgsService.listInvitations(req.params.orgId);
      res.json(invites);
    } catch (err) { next(err); }
  }

  async listPeople(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      const people = await orgsService.listPeopleWithInvites(req.params.orgId);
      res.json(people);
    } catch (err) {
      next(err);
    }
  }

  /** Get the current user's primary organization (first membership) */
  async getCurrentForUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const row = await queryOne<{ organization_id: string }>(
        `SELECT organization_id
         FROM organization_members
         WHERE user_id = $1 AND status = 'active'
         ORDER BY joined_at ASC
         LIMIT 1`,
        [req.user!.userId]
      );
      if (!row) throw new AppError('You are not a member of any organization', 404, 'NOT_A_MEMBER');
      const org = await orgsService.getById(row.organization_id);
      res.json(org);
    } catch (err) { next(err); }
  }

  async removeMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const requester = await requireOrgAdmin(req.params.orgId, req.user!.userId);

      const targetMember = await queryOne<{ id: string; role_name: string }>(
        `SELECT om.id, r.name as role_name
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.id = $1 AND om.organization_id = $2`,
        [req.params.memberId, req.params.orgId]
      );
      if (!targetMember) throw new AppError('Member not found in this organization', 404, 'NOT_FOUND');
      if (targetMember.role_name === 'owner') {
        throw new AppError('The organization owner cannot be removed', 403, 'FORBIDDEN');
      }
      if (targetMember.role_name === 'admin' && requester.role_name !== 'owner') {
        throw new AppError('Only the organization owner can remove admins', 403, 'INSUFFICIENT_PERMISSIONS');
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
      await requireOrgAdmin(req.params.orgId, req.user!.userId);
      const file = req.file;
      if (!file) throw new AppError('No file provided', 400, 'FILE_MISSING');
      if (!isAllowedImageType(file.mimetype)) throw new AppError('Only image files (JPEG, PNG, GIF, WebP) are allowed', 400, 'FILE_TYPE_NOT_ALLOWED');
      const org = await orgsService.uploadLogo(req.params.orgId, file);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPLOAD_LOGO', { mimetype: file.mimetype });
      res.json(org);
    } catch (err) { next(err); }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await requireOrgAdmin(req.params.orgId, req.user!.userId);
      const org = await orgsService.updateOrg(req.params.orgId, req.body);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPDATE', { changes: Object.keys(req.body) });
      res.json(org);
    } catch (err) { next(err); }
  }

  async createDepartment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await requireOrgMember(req.params.orgId, req.user!.userId);
      requireAdminRole(member, 'create departments');

      const dept = await orgsService.createDepartment(req.params.orgId, member.id, req.body.name);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_CREATE_DEPARTMENT', { departmentId: dept.id, name: req.body.name });
      res.status(201).json(dept);
    } catch (err) { next(err); }
  }

  async listDepartments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await requireOrgMember(req.params.orgId, req.user!.userId);
      const depts = await orgsService.listDepartments(req.params.orgId);
      res.json(depts);
    } catch (err) { next(err); }
  }

  async deleteDepartment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await requireOrgMember(req.params.orgId, req.user!.userId);
      requireAdminRole(member, 'delete departments');

      const result = await orgsService.deleteDepartment(req.params.orgId, req.params.departmentId);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_DELETE_DEPARTMENT', { departmentId: req.params.departmentId });
      res.json(result);
    } catch (err) { next(err); }
  }

  async updateDepartment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await requireOrgMember(req.params.orgId, req.user!.userId);
      requireAdminRole(member, 'update departments');

      const dept = await orgsService.updateDepartment(req.params.orgId, req.params.departmentId, req.body.name);
      await audit.create(req.params.orgId, req.user!.userId, 'ORG_UPDATE_DEPARTMENT', {
        departmentId: req.params.departmentId,
        name: req.body.name,
      });
      res.json(dept);
    } catch (err) {
      next(err);
    }
  }
}
