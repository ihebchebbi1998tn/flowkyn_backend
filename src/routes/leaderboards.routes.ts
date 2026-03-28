/**
 * @fileoverview Leaderboards Routes
 *
 * GET /leaderboards/:id          — Get leaderboard by ID
 * GET /leaderboards/:id/entries  — Get leaderboard entries
 */

import { Router } from 'express';
import { LeaderboardsController } from '../controllers/leaderboards.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new LeaderboardsController();

router.get('/:id', authenticate, validate(uuidParam, 'params'), ctrl.getById);
router.get('/:id/entries', authenticate, validate(uuidParam, 'params'), ctrl.getEntries);

export { router as leaderboardsRoutes };
