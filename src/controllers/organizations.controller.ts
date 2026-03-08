import { Response, NextFunction } from 'express';
import { OrganizationsService } from '../services/organizations.service';
import { AuthRequest } from '../types';

const orgsService = new OrganizationsService();

export class OrganizationsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const org = await orgsService.create(req.user!.userId, req.body.name);
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

  async inviteMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.params.orgId, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member of this organization' }); return; }
      const result = await orgsService.inviteMember(req.params.orgId, member.id, req.body.email, req.body.role_id);
      res.json(result);
    } catch (err) { next(err); }
  }

  async acceptInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await orgsService.acceptInvitation(req.user!.userId, req.body.token);
      res.json(result);
    } catch (err) { next(err); }
  }
}
