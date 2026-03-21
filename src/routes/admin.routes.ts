import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { ContactController } from '../controllers/contact.controller';
import { EarlyAccessController } from '../controllers/earlyAccess.controller';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { validate } from '../middleware/validate';
import { earlyAccessAdminSendCredentialsSchema } from '../validators/earlyAccess.validator';
import featureFlagsRouter from '../controllers/featureFlags.controller';
import gameContentRouter from '../controllers/gameContent.controller';
import contentModerationRouter from '../controllers/contentModeration.controller';
import userEngagementRouter from '../controllers/userEngagement.controller';
import organizationAnalyticsRouter from '../controllers/organizationAnalytics.controller';
import analyticsReportsRouter from '../controllers/analyticsReports.controller';

const router = Router();
const ctrl = new AdminController();
const contactCtrl = new ContactController();
const earlyAccessCtrl = new EarlyAccessController();

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
router.patch('/organizations/:id/status', ctrl.updateOrganizationStatus);
router.post('/organizations/:orgId/ban', ctrl.banOrganization);
router.post('/organizations/:orgId/unban', ctrl.unbanOrganization);
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

// Early access submissions
router.get('/early-access', earlyAccessCtrl.list);
router.post('/early-access/:id/send-credentials', validate(earlyAccessAdminSendCredentialsSchema), earlyAccessCtrl.sendCredentials);

// TIER 1 Feature Routes
router.use('/feature-flags', featureFlagsRouter);
router.use('/game-content', gameContentRouter);
router.use('/content-moderation', contentModerationRouter);
router.use('/user-engagement', userEngagementRouter);
router.use('/org-analytics', organizationAnalyticsRouter);
router.use('/analytics-reports', analyticsReportsRouter);

export { router as adminRoutes };
