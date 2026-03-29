import { Router } from 'express';
import { ActivityFeedbacksController } from '../controllers/activityFeedbacks.controller';
import { authenticate } from '../middleware/auth';
import { authenticateOrGuest } from '../middleware/guestAuth';
import { requireSuperAdmin } from '../config/superAdmin';

const router = Router();
const ctrl = new ActivityFeedbacksController();

// User (member + guest) — submit feedback
router.post('/', authenticateOrGuest, ctrl.create.bind(ctrl));

// Admin — stats (super-admin only)
router.get('/admin/stats', authenticate, requireSuperAdmin, ctrl.getStats.bind(ctrl));

// Admin — list with filters (super-admin only)
router.get('/admin', authenticate, requireSuperAdmin, ctrl.listAdmin.bind(ctrl));

// Admin — detail
router.get('/:id', authenticate, requireSuperAdmin, ctrl.getByIdAdmin.bind(ctrl));

export { router as activityFeedbacksRoutes };

