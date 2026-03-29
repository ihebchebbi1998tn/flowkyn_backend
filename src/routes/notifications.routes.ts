/**
 * @fileoverview Notifications Routes
 *
 * GET  /notifications       — List user's notifications (paginated)
 * PATCH /notifications/:id  — Mark a single notification as read
 */

import { Router } from 'express';
import { NotificationsController } from '../controllers/notifications.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new NotificationsController();

router.get('/', authenticate, ctrl.list);
router.patch('/:id', authenticate, validate(uuidParam, 'params'), ctrl.markRead);

export { router as notificationsRoutes };
