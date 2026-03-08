import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service';
import { AuthRequest } from '../types';

const adminService = new AdminService();

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

  async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.updateUser(req.params.id, req.body);
      res.json(user);
    } catch (err) { next(err); }
  }

  async suspendUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.suspendUser(req.params.id);
      res.json({ message: 'User suspended' });
    } catch (err) { next(err); }
  }

  async unsuspendUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.unsuspendUser(req.params.id);
      res.json({ message: 'User unsuspended' });
    } catch (err) { next(err); }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.deleteUser(req.params.id);
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

  async deleteOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.deleteOrganization(req.params.id);
      res.status(204).end();
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
}
