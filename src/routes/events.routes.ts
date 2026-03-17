/**
 * @fileoverview Events Routes
 *
 * Public:
 *   GET  /events/:eventId/public         — Public event info for lobby
 *   GET  /events/:eventId/validate-token — Validate invitation token
 *   POST /events/:eventId/join-guest     — Guest join (no auth)
 *   GET  /events/:eventId/participants   — List participants
 *   GET  /events/:eventId/pinned-message — Get pinned chat message
 *
 * Authenticated:
 *   GET    /events                        — List events
 *   POST   /events                        — Create event
 *   GET    /events/:eventId               — Get event details
 *   PUT    /events/:eventId               — Update event
 *   DELETE /events/:eventId               — Delete event
 *   POST   /events/:eventId/invitations   — Send invitation email
 *   POST   /events/:eventId/accept-invitation — Accept invitation
 *   POST   /events/:eventId/join          — Join as org member
 *   POST   /events/:eventId/leave         — Leave event
 *   POST   /events/:eventId/messages      — Send chat message
 *   GET    /events/:eventId/messages      — Get chat messages
 *   POST   /events/:eventId/posts         — Create activity post
 *   GET    /events/:eventId/posts         — List activity posts
 *   GET    /events/:eventId/me            — Get current participant identity for this event
 *   GET    /events/:eventId/profile       — Get current user's per-event profile
 *   PUT    /events/:eventId/profile       — Upsert current user's per-event profile
 *   POST   /events/:eventId/pin-message   — Pin a chat message
 *   DELETE /events/:eventId/pin-message   — Unpin chat message
 *
 * Post reactions:
 *   POST /posts/:postId/reactions         — React to a post
 */

import { Router } from 'express';
import { EventsController } from '../controllers/events.controller';
import { authenticate } from '../middleware/auth';
import { authenticateOrGuest } from '../middleware/guestAuth';
import { validate } from '../middleware/validate';
import {
  createEventSchema, updateEventSchema, inviteParticipantSchema,
  sendMessageSchema, createPostSchema, reactToPostSchema, guestJoinSchema,
} from '../validators/events.validator';
import { eventIdParam, postIdParam } from '../validators/common.validator';

const router = Router();
const ctrl = new EventsController();

// ─── Public routes (no auth) — for lobby & guest access ───
router.get('/:eventId/public', validate(eventIdParam, 'params'), ctrl.getPublicInfo);
router.get('/:eventId/validate-token', validate(eventIdParam, 'params'), ctrl.validateToken);
router.post('/:eventId/join-guest', validate(eventIdParam, 'params'), validate(guestJoinSchema), ctrl.joinAsGuest);
router.get('/:eventId/participants', validate(eventIdParam, 'params'), ctrl.getParticipants);
router.get('/:eventId/pinned-message', validate(eventIdParam, 'params'), ctrl.getPinnedMessage);

// ─── Authenticated routes ───
router.get('/', authenticate, ctrl.list);
router.post('/', authenticate, validate(createEventSchema), ctrl.create);
router.get('/:eventId', authenticate, validate(eventIdParam, 'params'), ctrl.getById);
router.put('/:eventId', authenticate, validate(eventIdParam, 'params'), validate(updateEventSchema), ctrl.update);
router.delete('/:eventId', authenticate, validate(eventIdParam, 'params'), ctrl.delete);
router.post('/:eventId/invitations', authenticate, validate(eventIdParam, 'params'), validate(inviteParticipantSchema), ctrl.invite);
router.post('/:eventId/accept-invitation', authenticate, validate(eventIdParam, 'params'), ctrl.acceptInvitation);
router.post('/:eventId/join', authenticate, validate(eventIdParam, 'params'), ctrl.join);
router.post('/:eventId/leave', authenticate, validate(eventIdParam, 'params'), ctrl.leave);
router.post('/:eventId/messages', authenticateOrGuest, validate(eventIdParam, 'params'), validate(sendMessageSchema), ctrl.sendMessage);
router.get('/:eventId/messages', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getMessages);
router.post('/:eventId/posts', authenticateOrGuest, validate(eventIdParam, 'params'), validate(createPostSchema), ctrl.createPost);
router.get('/:eventId/posts', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getPosts);
router.get('/:eventId/me', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getMyParticipant);
router.get('/:eventId/profile', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.getMyProfile);
router.put('/:eventId/profile', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.upsertMyProfile);
router.post('/:eventId/pin-message', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.pinMessage);
router.delete('/:eventId/pin-message', authenticateOrGuest, validate(eventIdParam, 'params'), ctrl.unpinMessage);

// Post reactions (nested under /posts)
const postsRouter = Router();
postsRouter.post('/:postId/reactions', authenticateOrGuest, validate(postIdParam, 'params'), validate(reactToPostSchema), ctrl.reactToPost);

export { router as eventsRoutes, postsRouter as postsRoutes };
