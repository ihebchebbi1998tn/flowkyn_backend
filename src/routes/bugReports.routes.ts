import { Router } from 'express';
import { BugReportController } from '../controllers/bugReports.controller';
import { authenticate } from '../middleware/auth';
import { fileUpload } from '../config/multer';
import { requireSuperAdmin } from '../config/superAdmin';

const router = Router();
const ctrl = new BugReportController();

/**
 * User routes — authenticated users can create/view their own bug reports
 */

// Create bug report
router.post('/', authenticate, ctrl.create.bind(ctrl));

// List bug reports (users see own, admins see all)
router.get('/', authenticate, ctrl.list.bind(ctrl));

// Get single bug report
router.get('/:id', authenticate, ctrl.getById.bind(ctrl));

// Update bug report (admin only)
router.patch('/:id', authenticate, requireSuperAdmin, ctrl.update.bind(ctrl));

// Delete bug report (users can delete own unresolved, admins can delete any)
router.delete('/:id', authenticate, ctrl.delete.bind(ctrl));

// Upload attachment to bug report
router.post('/:id/attachments', authenticate, fileUpload.single('file'), ctrl.addAttachment.bind(ctrl));

// Delete attachment
router.delete('/:id/attachments/:attachmentId', authenticate, ctrl.deleteAttachment.bind(ctrl));

/**
 * Admin routes — super admin only
 */

// Get bug report stats
router.get('/admin/stats', authenticate, requireSuperAdmin, ctrl.getStats.bind(ctrl));

// Get audit history for a report
router.get('/:id/history', authenticate, requireSuperAdmin, ctrl.getHistory.bind(ctrl));

export { router as bugReportsRoutes };
