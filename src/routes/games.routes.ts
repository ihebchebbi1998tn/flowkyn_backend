/**
 * @fileoverview Games Routes
 *
 * GET  /game-types                          — List available game types
 * GET  /game-types/:id/prompts              — List prompts for a game type
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
import { debriefRateLimiter } from '../middleware/rateLimiter';
import { startSessionSchema, submitActionSchema, createStrategicSessionSchema } from '../validators/games.validator';
import { eventIdParam, uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new GamesController();

// Game types (authenticated users only)
router.get('/game-types', authenticate, ctrl.listGameTypes);
router.get('/game-types/:id/prompts', authenticate, ctrl.listPrompts);

// Game sessions (under events) — admin-only operations
router.post('/events/:eventId/game-sessions', authenticate, validate(eventIdParam, 'params'), validate(startSessionSchema), ctrl.startSession);
// Strategic Escape Challenge sessions
router.post(
  '/events/:eventId/strategic-sessions',
  authenticate,
  validate(eventIdParam, 'params'),
  validate(createStrategicSessionSchema),
  ctrl.createStrategicSession
);
// Resolve currently active session for an event + game key (supports guests)
router.get('/events/:eventId/game-sessions/active', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getActiveSessionForEvent);
router.post('/game-sessions/:id/rounds', authenticate, validate(uuidParam, 'params'), ctrl.startRound);
router.post('/game-sessions/:id/finish', authenticate, validate(uuidParam, 'params'), ctrl.finishSession);
router.get('/game-sessions/:id/actions', authenticate, validate(uuidParam, 'params'), ctrl.getSessionActions);
router.get('/game-sessions/:id/snapshots', authenticate, validate(uuidParam, 'params'), ctrl.getSessionSnapshots);

// Strategic Escape Challenge helpers
router.post('/strategic-sessions/:sessionId/assign-roles', authenticate, validate(uuidParam, 'params'), ctrl.assignStrategicRolesForSession);
router.get('/strategic-sessions/:sessionId/roles/me', authenticateOrGuest, validate(uuidParam, 'params'), ctrl.getMyStrategicRole);
router.get('/strategic-sessions/:sessionId/debrief-results', authenticate, debriefRateLimiter, validate(uuidParam, 'params'), ctrl.getDebriefResults);
router.post('/strategic-sessions/:sessionId/start-debrief', authenticate, debriefRateLimiter, validate(uuidParam, 'params'), ctrl.startDebrief);

// Game actions — supports BOTH authenticated users AND guests via authenticateOrGuest
router.post('/game-actions', authenticateOrGuest, validate(submitActionSchema), ctrl.submitAction);

export { router as gamesRoutes };
