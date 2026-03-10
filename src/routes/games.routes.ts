/**
 * @fileoverview Games Routes
 *
 * GET  /game-types                          — List available game types
 * POST /events/:eventId/game-sessions       — Start a new game session
 * POST /game-sessions/:id/rounds            — Start next round
 * POST /game-sessions/:id/finish            — Finish session
 * POST /game-actions                        — Submit a game action (supports guests)
 */

import { Router } from 'express';
import { GamesController } from '../controllers/games.controller';
import { authenticate } from '../middleware/auth';
import { authenticateOrGuest } from '../middleware/guestAuth';
import { validate } from '../middleware/validate';
import { startSessionSchema, submitActionSchema } from '../validators/games.validator';
import { eventIdParam, uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new GamesController();

// Game types (authenticated users only)
router.get('/game-types', authenticate, ctrl.listGameTypes);

// Game sessions (under events) — admin-only operations
router.post('/events/:eventId/game-sessions', authenticate, validate(eventIdParam, 'params'), validate(startSessionSchema), ctrl.startSession);
router.post('/game-sessions/:id/rounds', authenticate, validate(uuidParam, 'params'), ctrl.startRound);
router.post('/game-sessions/:id/finish', authenticate, validate(uuidParam, 'params'), ctrl.finishSession);

// Game actions — supports BOTH authenticated users AND guests via authenticateOrGuest
router.post('/game-actions', authenticateOrGuest, validate(submitActionSchema), ctrl.submitAction);

export { router as gamesRoutes };
