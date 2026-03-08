import { Router } from 'express';
import { GamesController } from '../controllers/games.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { startSessionSchema, submitActionSchema } from '../validators/games.validator';

const router = Router();
const ctrl = new GamesController();

// Game types
router.get('/game-types', authenticate, ctrl.listGameTypes);

// Game sessions (under events)
router.post('/events/:eventId/game-sessions', authenticate, validate(startSessionSchema), ctrl.startSession);
router.post('/game-sessions/:id/rounds', authenticate, ctrl.startRound);
router.post('/game-sessions/:id/finish', authenticate, ctrl.finishSession);

// Game actions
router.post('/game-actions', authenticate, validate(submitActionSchema), ctrl.submitAction);

export { router as gamesRoutes };
