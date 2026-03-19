import { Request, Response, NextFunction } from 'express';
import { EarlyAccessService } from '../services/earlyAccess.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';

const earlyAccessService = new EarlyAccessService();
const audit = new AuditLogsService();

export class EarlyAccessController {
  /** Public — anyone can submit early-access interest */
  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const { firstName, lastName, email, companyName } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString();

      const submission = await earlyAccessService.create({
        firstName,
        lastName,
        email,
        companyName,
        ipAddress,
      });

      await audit.create(null, null, 'EARLY_ACCESS_SUBMIT', {
        email,
        ip: ipAddress,
      });

      res.status(201).json({
        message: 'Early access request received',
        id: submission.id,
      });
    } catch (err) {
      next(err);
    }
  }

  /** Admin — list all early access submissions */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20' } = req.query;
      const result = await earlyAccessService.list(Number(page), Number(limit));
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** Admin — provision account and send credentials email for one early access request */
  async sendCredentials(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
        throw new AppError('Invalid request ID format', 400, 'INVALID_FORMAT');
      }
      const { personalizedMessage, resetPasswordIfExists } = req.body as {
        personalizedMessage?: string;
        resetPasswordIfExists?: boolean;
      };
      const result = await earlyAccessService.provisionAccountAndSendCredentials(
        req.params.id,
        typeof personalizedMessage === 'string' ? personalizedMessage : '',
        typeof resetPasswordIfExists === 'boolean' ? resetPasswordIfExists : true
      );

      await audit.create(null, req.user?.userId || null, 'EARLY_ACCESS_SEND_CREDENTIALS', {
        requestId: req.params.id,
        targetEmail: result.email,
        createdNewAccount: result.createdNewAccount,
        passwordResetApplied: result.passwordResetApplied,
      });

      res.json({
        message: 'Credentials email sent successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

