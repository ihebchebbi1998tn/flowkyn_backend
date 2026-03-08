import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';

const authService = new AuthService();
const audit = new AuditLogsService();

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, name, lang } = req.body;
      const result = await authService.register(email, password, name, lang);
      await audit.create(null, result.user?.id || '', 'AUTH_REGISTER', { email, ip: req.ip });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.verifyEmail(req.body.token);
      await audit.create(null, '', 'AUTH_VERIFY_EMAIL', { ip: req.ip });
      res.json(result);
    } catch (err) { next(err); }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const ip = req.ip || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';
      const result = await authService.login(email, password, ip, userAgent);
      await audit.create(null, result.user?.id || '', 'AUTH_LOGIN', { email, ip, userAgent });
      res.json(result);
    } catch (err) { next(err); }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.refresh(req.body.refresh_token);
      res.json(result);
    } catch (err) { next(err); }
  }

  async logout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.logout(req.user!.userId);
      await audit.create(null, req.user!.userId, 'AUTH_LOGOUT', { ip: req.ip });
      res.json(result);
    } catch (err) { next(err); }
  }

  async getMe(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getMe(req.user!.userId);
      res.json(user);
    } catch (err) { next(err); }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPassword(req.body.email, req.body.lang);
      await audit.create(null, '', 'AUTH_FORGOT_PASSWORD', { email: req.body.email, ip: req.ip });
      res.json(result);
    } catch (err) { next(err); }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.resetPassword(req.body.token, req.body.password);
      await audit.create(null, '', 'AUTH_RESET_PASSWORD', { ip: req.ip });
      res.json(result);
    } catch (err) { next(err); }
  }
}
