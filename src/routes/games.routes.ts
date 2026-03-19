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
import { startSessionSchema, submitActionSchema, createStrategicSessionSchema, updateStrategicNotesSchema } from '../validators/games.validator';
import { eventIdParam, sessionIdParam, uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new GamesController();

// Game types (authenticated users only)
router.get('/game-types', authenticate, ctrl.listGameTypes);
router.get('/game-types/:id/prompts', authenticate, ctrl.listPrompts);

// WebRTC voice helpers (used by Coffee Roulette)
// Supports both authenticated users and guests.
router.get('/voice/ice-servers', authenticateOrGuest, ctrl.getIceServers);

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
router.post('/strategic-sessions/:sessionId/assign-roles', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.assignStrategicRolesForSession);
router.get('/strategic-sessions/:sessionId/roles/me', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.getMyStrategicRole);
router.post('/strategic-sessions/:sessionId/roles/me/ack', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.acknowledgeMyStrategicRole);
router.get('/strategic-sessions/:sessionId/roles/reveal-status', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.getStrategicRoleRevealStatus);
router.post('/strategic-sessions/:sessionId/roles/me/ready', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.readyMyStrategicRole);
router.get('/strategic-sessions/:sessionId/roles/ready-status', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.getStrategicRoleReadyStatus);
router.get('/strategic-sessions/:sessionId/roles/me/prompts', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.getMyStrategicRolePromptState);
router.post('/strategic-sessions/:sessionId/roles/me/prompts/next', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.advanceMyStrategicRolePrompt);
router.get('/strategic-sessions/:sessionId/roles/me/notes', authenticateOrGuest, validate(sessionIdParam, 'params'), ctrl.getMyStrategicNotes);
router.put(
  '/strategic-sessions/:sessionId/roles/me/notes',
  authenticateOrGuest,
  validate(sessionIdParam, 'params'),
  validate(updateStrategicNotesSchema),
  ctrl.updateMyStrategicNotes
);
router.get('/strategic-sessions/:sessionId/debrief-results', authenticate, debriefRateLimiter, validate(sessionIdParam, 'params'), ctrl.getDebriefResults);
router.post('/strategic-sessions/:sessionId/start-debrief', authenticate, debriefRateLimiter, validate(sessionIdParam, 'params'), ctrl.startDebrief);

// Game actions — supports BOTH authenticated users AND guests via authenticateOrGuest
router.post('/game-actions', authenticateOrGuest, validate(submitActionSchema), ctrl.submitAction);

export { router as gamesRoutes };
