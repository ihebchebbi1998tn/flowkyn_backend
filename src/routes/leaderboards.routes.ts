/**
 * @fileoverview Leaderboards Routes
 *
 * GET /leaderboards/:id          — Get leaderboard by ID
 * GET /leaderboards/:id/entries  — Get leaderboard entries
 */

import { Router } from 'express';
import { LeaderboardsController } from '../controllers/leaderboards.controller';
import { authenticateOrGuest } from '../middleware/guestAuth';
import { validate } from '../middleware/validate';
import { uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new LeaderboardsController();

router.get('/:id', authenticateOrGuest, validate(uuidParam, 'params'), ctrl.getById);
router.get('/:id/entries', authenticateOrGuest, validate(uuidParam, 'params'), ctrl.getEntries);

export { router as leaderboardsRoutes };
