/**
 * Events Controller — Messages & Posts
 */
import { Response, NextFunction } from 'express';
import { EventsService } from '../../services/events.service';
import { EventMessagesService } from '../../services/events-messages.service';
import { OrganizationsService } from '../../services/organizations.service';
import { AuditLogsService } from '../../services/auditLogs.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { emitEventNotification } from '../../socket/emitter';
import { queryOne } from '../../config/database';
import { getEventAuthPayload, verifyParticipantOwnership, requireCurrentParticipantId } from './helpers';

const eventsService = new EventsService();
const messagesService = new EventMessagesService();
const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

export class EventsMessagesController {
  async sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      await verifyParticipantOwnership(req.body.participant_id, auth);
      const result = await messagesService.sendMessage(req.params.eventId, req.body.participant_id, req.body.message);
      await audit.create(null, auth.userId ?? null, 'EVENT_SEND_MESSAGE', { eventId: req.params.eventId, messageId: result.id });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;

      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
      } else {
        const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
        if (!member) throw new AppError('You must be an organization member to view messages', 403, 'NOT_A_MEMBER');
      }

      const result = await messagesService.getMessages(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getPosts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;

      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
      } else {
        const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
        if (!member) throw new AppError('You must be an organization member to view posts', 403, 'NOT_A_MEMBER');
      }

      const participantId = await requireCurrentParticipantId(req.params.eventId, userPayload);
      const result = await messagesService.getPosts(req.params.eventId, req.query as any, participantId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async createPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      await verifyParticipantOwnership(req.body.participant_id, auth);
      const result = await messagesService.createPost(req.params.eventId, req.body.participant_id, req.body.content, req.body.parent_post_id);
      await audit.create(null, auth.userId ?? null, 'EVENT_CREATE_POST', { eventId: req.params.eventId, postId: result.id });
      emitEventNotification(req.params.eventId, 'post:created', { postId: result.id, authorId: auth.userId || auth.participantId });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async reactToPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const postRow = await queryOne<{ event_id: string }>('SELECT event_id FROM activity_posts WHERE id = $1', [req.params.postId]);
      if (!postRow) throw new AppError('Post not found', 404, 'NOT_FOUND');

      const participantId = await requireCurrentParticipantId(postRow.event_id, auth);
      const result = await messagesService.reactToPost(req.params.postId, participantId, req.body.reaction_type);
      await audit.create(null, auth.userId ?? null, 'EVENT_REACT_POST', { postId: req.params.postId, reactionType: req.body.reaction_type });

      try {
        if (postRow?.event_id) {
          emitEventNotification(postRow.event_id, 'post:reacted', { postId: req.params.postId, participantId, reactionType: req.body.reaction_type });
        }
      } catch { /* non-fatal */ }

      res.status(201).json(result);
    } catch (err) { next(err); }
  }
}
