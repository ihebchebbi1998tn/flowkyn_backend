import { Request, Response, NextFunction } from 'express';
import { BugReportService } from '../services/bugReports.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';

// Super admin emails from environment
const DEFAULT_SUPER_ADMINS = (process.env.SUPER_ADMIN_DEFAULT_EMAIL || 'support@flowkyn.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const SUPER_ADMIN_EMAILS = [
  ...DEFAULT_SUPER_ADMINS,
  ...(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
];

const bugReportService = new BugReportService();
const auditService = new AuditLogsService();

export class BugReportController {
  /**
   * Create a new bug report
   * PUBLIC — any authenticated user can create
   */
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { title, description, type = 'bug_report', priority = 'medium' } = req.body;
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0];

      const report = await bugReportService.create({
        userId: req.user!.userId,
        title,
        description,
        type,
        priority,
        ipAddress,
      });

      await auditService.create(null, req.user!.userId, 'BUG_REPORT_CREATE', {
        reportId: report.id,
        type,
        priority,
      });

      res.status(201).json({
        message: 'Bug report created successfully',
        data: report,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get single bug report by ID
   * Users can see their own, admins can see all
   */
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(req.user?.email?.toLowerCase() || '');
      
      const report = await bugReportService.getById(
        req.params.id,
        req.user?.userId,
        isSuperAdmin,
      );

      // Get attachments
      const attachments = await bugReportService.getAttachments(report.id);
      const history = await bugReportService.getHistory(report.id);

      res.json({
        data: report,
        attachments,
        history,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * List bug reports
   * Users see only their own unless they're admins
   */
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        page = '1',
        limit = '20',
        status,
        priority,
        type,
        search,
        assignedTo,
      } = req.query;

      const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(req.user?.email?.toLowerCase() || '');
      const userId = isSuperAdmin ? undefined : req.user?.userId;

      const result = await bugReportService.list({
        page: Number(page),
        limit: Number(limit),
        userId,
        status: status as string,
        priority: priority as string,
        type: type as string,
        assignedTo: assignedTo as string,
        search: search as string,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update bug report (admin only)
   */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { status, priority, assignedToUserId, resolutionNotes } = req.body;

      const report = await bugReportService.update(
        req.params.id,
        {
          status,
          priority,
          assignedToUserId,
          resolutionNotes,
        },
        req.user!.userId,
      );

      await auditService.create(null, req.user!.userId, 'BUG_REPORT_UPDATE', {
        reportId: req.params.id,
        updates: { status, priority, assignedToUserId, resolutionNotes },
      });

      res.json({
        message: 'Bug report updated successfully',
        data: report,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete bug report (users can delete own unresolved, admins can delete any)
   */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(req.user?.email?.toLowerCase() || '');

      await bugReportService.delete(req.params.id, req.user?.userId, isSuperAdmin);

      await auditService.create(null, req.user!.userId, 'BUG_REPORT_DELETE', {
        reportId: req.params.id,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Upload attachment to a bug report
   */
  async addAttachment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new AppError('No file provided', 400, 'VALIDATION_FAILED');
      }

      // Verify bug report exists and user can access it
      await bugReportService.getById(req.params.id, req.user?.userId);

      const { isAllowedFileType, saveFile } = await import('../utils/upload');
      if (!isAllowedFileType(req.file.mimetype)) {
        throw new AppError(`File type "${req.file.mimetype}" is not allowed`, 400, 'FILE_TYPE_NOT_ALLOWED');
      }

      // Store locally under uploads/bug-reports/<reportId>/... and serve via /uploads static route
      const { url } = saveFile(req.file.buffer, req.file.originalname, `bug-reports/${req.params.id}`);
      const fileUrl = url;

      const attachment = await bugReportService.addAttachment({
        bugReportId: req.params.id,
        uploadedByUserId: req.user!.userId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        fileUrl,
      });

      await auditService.create(null, req.user!.userId, 'BUG_REPORT_ATTACHMENT_ADD', {
        reportId: req.params.id,
        fileName: req.file.originalname,
      });

      res.status(201).json({
        message: 'Attachment uploaded successfully',
        data: attachment,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete attachment
   */
  async deleteAttachment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const fileUrl = await bugReportService.deleteAttachment(req.params.attachmentId);
      if (fileUrl) {
        const { deleteFile } = await import('../utils/upload');
        // Support both absolute and relative URLs; extract the path after `/uploads/`
        const marker = '/uploads/';
        const idx = fileUrl.indexOf(marker);
        if (idx >= 0) {
          const rel = fileUrl.slice(idx + marker.length);
          deleteFile(rel);
        }
      }

      await auditService.create(null, req.user!.userId, 'BUG_REPORT_ATTACHMENT_DELETE', {
        reportId: req.params.id,
        attachmentId: req.params.attachmentId,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get bug report stats (admin only)
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await bugReportService.getStats();
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get history/audit trail for a report (admin only)
   */
  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await bugReportService.getHistory(req.params.id);
      res.json({ data: history });
    } catch (err) {
      next(err);
    }
  }
}
