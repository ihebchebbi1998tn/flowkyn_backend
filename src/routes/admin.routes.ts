import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AdminController();

// All admin routes require authentication
// TODO: Add super-admin role check middleware
router.use(authenticate);

// Dashboard
router.get('/stats', ctrl.getStats);

// Users
router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUserById);
router.patch('/users/:id', ctrl.updateUser);
router.post('/users/:id/suspend', ctrl.suspendUser);
router.post('/users/:id/unsuspend', ctrl.unsuspendUser);
router.delete('/users/:id', ctrl.deleteUser);

// Organizations
router.get('/organizations', ctrl.listOrganizations);
router.delete('/organizations/:id', ctrl.deleteOrganization);

// Game sessions
router.get('/game-sessions', ctrl.listGameSessions);

// Audit logs
router.get('/audit-logs', ctrl.listAuditLogs);

export { router as adminRoutes };
