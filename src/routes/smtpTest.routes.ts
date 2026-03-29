import { Router } from 'express';
import { SmtpTestController } from '../controllers/smtpTest.controller';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';

const router = Router();
const ctrl = new SmtpTestController();

// All SMTP test routes require authentication + super-admin role
router.use(authenticate);
router.use(requireSuperAdmin);

// POST /smtp-test — test a single SMTP config
router.post('/', ctrl.testConnection);

// POST /smtp-test/bulk — test multiple configs at once
router.post('/bulk', ctrl.bulkTest);

export { router as smtpTestRoutes };
