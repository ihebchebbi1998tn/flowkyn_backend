import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { usersRoutes } from './users.routes';
import { organizationsRoutes } from './organizations.routes';
import { eventsRoutes, postsRoutes } from './events.routes';
import { gamesRoutes } from './games.routes';
import { leaderboardsRoutes } from './leaderboards.routes';
import { notificationsRoutes } from './notifications.routes';
import { filesRoutes } from './files.routes';
import { analyticsRoutes } from './analytics.routes';
import { auditLogsRoutes } from './auditLogs.routes';
import { adminRoutes } from './admin.routes';
import { contactRoutes } from './contact.routes';
import { smtpTestRoutes } from './smtpTest.routes';
import { bugReportsRoutes } from './bugReports.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/organizations', organizationsRoutes);
router.use('/events', eventsRoutes);
router.use('/posts', postsRoutes);
router.use('/', gamesRoutes);
router.use('/leaderboards', leaderboardsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/files', filesRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/audit-logs', auditLogsRoutes);
router.use('/admin', adminRoutes);
router.use('/contact', contactRoutes);
router.use('/bug-reports', bugReportsRoutes);
router.use('/smtp-test', smtpTestRoutes);

export { router as routes };
