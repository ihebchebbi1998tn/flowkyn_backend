import { Router } from 'express';
import { LeaderboardsController } from '../controllers/leaderboards.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new LeaderboardsController();

router.get('/:id', authenticate, ctrl.getById);
router.get('/:id/entries', authenticate, ctrl.getEntries);

export { router as leaderboardsRoutes };
