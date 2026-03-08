import { Router } from 'express';
import { NotificationsController } from '../controllers/notifications.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new NotificationsController();

router.get('/', authenticate, ctrl.list);
router.patch('/:id', authenticate, ctrl.markRead);

export { router as notificationsRoutes };
