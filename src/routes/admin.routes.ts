import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { ContactController } from '../controllers/contact.controller';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';

const router = Router();
const ctrl = new AdminController();
const contactCtrl = new ContactController();

// All admin routes require authentication + super-admin role
router.use(authenticate);
router.use(requireSuperAdmin);

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

// Contact submissions
router.get('/contact', contactCtrl.list);
router.get('/contact/:id', contactCtrl.getById);
router.patch('/contact/:id', contactCtrl.updateStatus);
router.delete('/contact/:id', contactCtrl.delete);

export { router as adminRoutes };
