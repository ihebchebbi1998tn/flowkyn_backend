import { Router } from 'express';
import { SmtpTestController } from '../controllers/smtpTest.controller';

const router = Router();
const ctrl = new SmtpTestController();

// POST /smtp-test — test a single SMTP config
router.post('/', ctrl.testConnection);

// POST /smtp-test/bulk — test multiple configs at once
router.post('/bulk', ctrl.bulkTest);

export { router as smtpTestRoutes };
