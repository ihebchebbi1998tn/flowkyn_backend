import { Router } from 'express';
import { AuditLogsController } from '../controllers/auditLogs.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AuditLogsController();

// SECURITY: Removed POST /audit-logs — audit logs must only be created server-side
// Only authenticated org admins can view their org's audit logs
router.get('/organizations/:orgId', authenticate, ctrl.listByOrg);

export { router as auditLogsRoutes };
