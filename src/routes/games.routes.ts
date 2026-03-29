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
import { StrategicGamesController } from '../controllers/strategicGames.controller';
import { GameSessionsController } from '../controllers/gameSessions.controller';
import { authenticate } from '../middleware/auth';
import { authenticateOrGuest } from '../middleware/guestAuth';
import { validate } from '../middleware/validate';
import { debriefRateLimiter } from '../middleware/rateLimiter';
import { startSessionSchema, submitActionSchema, createStrategicSessionSchema, updateStrategicNotesSchema } from '../validators/games.validator';
import { eventIdParam, sessionIdParam, uuidParam } from '../validators/common.validator';

const router = Router();
const ctrl = new GamesController();
const strategicCtrl = new StrategicGamesController();
const sessionCtrl = new GameSessionsController();

// Game types — allow guests to see available games
router.get('/game-types', authenticateOrGuest, ctrl.listGameTypes);
router.get('/game-types/:id/prompts', authenticateOrGuest, ctrl.listPrompts);

// WebRTC voice helpers (used by Coffee Roulette)
// Supports both authenticated users and guests.
router.get('/voice/ice-servers', authenticateOrGuest, ctrl.getIceServers);

// Testing helper — returns ICE servers WITHOUT Authorization.
// SECURITY NOTE: exposes TURN credentials to anyone who can reach the API.
router.get('/voice/ice-servers-public', ctrl.getIceServersPublic);

// Game sessions (under events) — admin-only operations
router.post('/events/:eventId/game-sessions', authenticateOrGuest, validate(eventIdParam, 'params'), validate(startSessionSchema), ctrl.startSession);
// Strategic Escape Challenge sessions
router.post(
  '/events/:eventId/strategic-sessions',
  authenticateOrGuest,
  validate(eventIdParam, 'params'),
  validate(createStrategicSessionSchema),
  strategicCtrl.createStrategicSession
);
// Resolve currently active session for an event + game key (supports guests)
router.get('/events/:eventId/game-sessions/active', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getActiveSessionForEvent);
router.post('/game-sessions/:id/rounds', authenticateOrGuest, validate(uuidParam, 'params'), ctrl.startRound);
router.post('/game-sessions/:id/finish', authenticateOrGuest, validate(uuidParam, 'params'), ctrl.finishSession);
router.get('/game-sessions/:id/actions', authenticate, validate(uuidParam, 'params'), ctrl.getSessionActions);
router.get('/game-sessions/:id/snapshots', authenticate, validate(uuidParam, 'params'), ctrl.getSessionSnapshots);

// Strategic Escape Challenge helpers
router.post('/strategic-sessions/:sessionId/assign-roles', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.assignStrategicRolesForSession);
router.get('/strategic-sessions/:sessionId/roles/me', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.getMyStrategicRole);
router.post('/strategic-sessions/:sessionId/roles/me/ack', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.acknowledgeMyStrategicRole);
router.get('/strategic-sessions/:sessionId/roles/reveal-status', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.getStrategicRoleRevealStatus);
router.post('/strategic-sessions/:sessionId/roles/me/ready', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.readyMyStrategicRole);
router.get('/strategic-sessions/:sessionId/roles/ready-status', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.getStrategicRoleReadyStatus);
router.get('/strategic-sessions/:sessionId/roles/me/prompts', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.getMyStrategicRolePromptState);
router.post('/strategic-sessions/:sessionId/roles/me/prompts/next', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.advanceMyStrategicRolePrompt);
router.get('/strategic-sessions/:sessionId/roles/me/notes', authenticateOrGuest, validate(sessionIdParam, 'params'), strategicCtrl.getMyStrategicNotes);
router.put(
  '/strategic-sessions/:sessionId/roles/me/notes',
  authenticateOrGuest,
  validate(sessionIdParam, 'params'),
  validate(updateStrategicNotesSchema),
  strategicCtrl.updateMyStrategicNotes
);
router.get('/strategic-sessions/:sessionId/debrief-results', authenticate, debriefRateLimiter, validate(sessionIdParam, 'params'), strategicCtrl.getDebriefResults);
router.post('/strategic-sessions/:sessionId/start-debrief', authenticate, debriefRateLimiter, validate(sessionIdParam, 'params'), strategicCtrl.startDebrief);

// Game actions — supports BOTH authenticated users AND guests via authenticateOrGuest
router.post('/game-actions', authenticateOrGuest, validate(submitActionSchema), ctrl.submitAction);

// Game Session Details — view comprehensive session data (admin-only)
router.get('/game-sessions/:sessionId/details', authenticate, validate(sessionIdParam, 'params'), sessionCtrl.getSessionDetails);
router.get('/game-sessions/:sessionId/messages', authenticate, validate(sessionIdParam, 'params'), sessionCtrl.getSessionMessages);
router.get('/game-sessions/:sessionId/export', authenticate, validate(sessionIdParam, 'params'), sessionCtrl.exportSessionData);
router.post('/game-sessions/:sessionId/close', authenticate, validate(sessionIdParam, 'params'), sessionCtrl.closeSession);
router.delete('/game-sessions/:sessionId', authenticate, validate(sessionIdParam, 'params'), sessionCtrl.deleteSession);
// List ALL active sessions for an event (returns array) — used by admin session management
router.get('/events/:eventId/game-sessions/active-list', authenticate, validate(eventIdParam, 'params'), sessionCtrl.getActiveSessionsForEvent);

export { router as gamesRoutes };
