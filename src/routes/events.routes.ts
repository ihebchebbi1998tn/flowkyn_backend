import { Router } from 'express';
import { EventsController } from '../controllers/events.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createEventSchema, updateEventSchema, inviteParticipantSchema, sendMessageSchema, createPostSchema, reactToPostSchema } from '../validators/events.validator';

const router = Router();
const ctrl = new EventsController();

router.get('/', authenticate, ctrl.list);
router.post('/', authenticate, validate(createEventSchema), ctrl.create);
router.get('/:eventId', authenticate, ctrl.getById);
router.put('/:eventId', authenticate, validate(updateEventSchema), ctrl.update);
router.delete('/:eventId', authenticate, ctrl.delete);
router.post('/:eventId/invitations', authenticate, validate(inviteParticipantSchema), ctrl.invite);
router.post('/:eventId/join', authenticate, ctrl.join);
router.post('/:eventId/leave', authenticate, ctrl.leave);
router.post('/:eventId/messages', authenticate, validate(sendMessageSchema), ctrl.sendMessage);
router.get('/:eventId/messages', authenticate, ctrl.getMessages);
router.post('/:eventId/posts', authenticate, validate(createPostSchema), ctrl.createPost);

// Post reactions (nested under /posts)
const postsRouter = Router();
postsRouter.post('/:postId/reactions', authenticate, validate(reactToPostSchema), ctrl.reactToPost);

export { router as eventsRoutes, postsRouter as postsRoutes };
