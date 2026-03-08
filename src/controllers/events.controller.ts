import { Response, NextFunction } from 'express';
import { EventsService } from '../services/events.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { emitEventUpdate, emitEventNotification } from '../socket/emitter';

const eventsService = new EventsService();
const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

export class EventsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.body.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const event = await eventsService.create(member.id, req.body);
      await audit.create(req.body.organization_id, req.user!.userId, 'EVENT_CREATE', { eventId: event.id, title: req.body.title });
      res.status(201).json(event);
    } catch (err) { next(err); }
  }

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const orgId = req.query.organization_id as string | undefined;
      const result = await eventsService.list(req.query as any, orgId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      res.json(event);
    } catch (err) { next(err); }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized to update this event' }); return; }
      const updated = await eventsService.update(req.params.eventId, req.body);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_UPDATE', { eventId: req.params.eventId, changes: Object.keys(req.body) });
      emitEventUpdate(req.params.eventId, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  }

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized to delete this event' }); return; }
      emitEventNotification(req.params.eventId, 'event:deleted', { eventId: req.params.eventId, title: event.title });
      const result = await eventsService.delete(req.params.eventId);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_DELETE', { eventId: req.params.eventId, title: event.title });
      res.json(result);
    } catch (err) { next(err); }
  }

  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized' }); return; }
      const result = await eventsService.inviteParticipant(req.params.eventId, member.id, req.body.email, req.body.lang);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_INVITE', { eventId: req.params.eventId, invitedEmail: req.body.email });
      res.json(result);
    } catch (err) { next(err); }
  }

  async join(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const result = await eventsService.join(req.params.eventId, member.id);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_JOIN', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:joined', {
        userId: req.user!.userId,
        participantId: result.participant_id,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  async leave(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const result = await eventsService.leave(req.params.eventId, member.id);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_LEAVE', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:left', { userId: req.user!.userId });
      res.json(result);
    } catch (err) { next(err); }
  }

  async sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await eventsService.sendMessage(req.params.eventId, req.body.participant_id, req.body.message);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await eventsService.getMessages(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  async createPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await eventsService.createPost(req.params.eventId, req.body.participant_id, req.body.content);
      emitEventNotification(req.params.eventId, 'post:created', {
        postId: result.id,
        authorId: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async reactToPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await eventsService.reactToPost(req.params.postId, req.body.participant_id, req.body.reaction_type);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
}
