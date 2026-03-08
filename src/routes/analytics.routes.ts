import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AnalyticsController();

router.post('/', authenticate, ctrl.track);

export { router as analyticsRoutes };
