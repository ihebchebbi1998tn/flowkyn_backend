import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AnalyticsController();

// Track an analytics event
router.post('/', authenticate, ctrl.track);

// Dashboard stats (aggregated for the authenticated user's orgs)
router.get('/dashboard', authenticate, ctrl.getDashboard);

// Analytics overview (engagement trends, breakdowns)
router.get('/overview', authenticate, ctrl.getOverview);

// Active game sessions for the authenticated user
router.get('/active-sessions', authenticate, ctrl.getActiveSessions);

export { router as analyticsRoutes };
