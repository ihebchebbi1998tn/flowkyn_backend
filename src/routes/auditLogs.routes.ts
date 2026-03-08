import { Router } from 'express';
import { AuditLogsController } from '../controllers/auditLogs.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AuditLogsController();

router.post('/', authenticate, ctrl.create);
router.get('/organizations/:orgId', authenticate, ctrl.listByOrg);

export { router as auditLogsRoutes };
