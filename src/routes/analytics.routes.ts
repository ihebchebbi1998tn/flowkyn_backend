import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { HRAnalyticsController } from '../controllers/hrAnalytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AnalyticsController();
const hrCtrl = new HRAnalyticsController();

// Track an analytics event
router.post('/', authenticate, ctrl.track);

// Dashboard stats (aggregated for the authenticated user's orgs)
router.get('/dashboard', authenticate, ctrl.getDashboard);

// Analytics overview (engagement trends, breakdowns)
router.get('/overview', authenticate, ctrl.getOverview);

// Active game sessions for the authenticated user
router.get('/active-sessions', authenticate, ctrl.getActiveSessions);

// Engagement metrics for an organization
router.get('/engagement/:organizationId', authenticate, ctrl.getEngagementMetrics);

// Real-time metrics for an organization
router.get('/realtime/:organizationId', authenticate, ctrl.getRealTimeMetrics);

// HR analytics dashboard for an organization
router.get('/hr/:organizationId', authenticate, hrCtrl.getDashboard);

// Detailed event analytics
router.get('/event/:eventId', authenticate, ctrl.getEventAnalytics);

// Participant rankings and leaderboard
router.get('/rankings/:organizationId', authenticate, ctrl.getParticipantRankings);

export { router as analyticsRoutes };
