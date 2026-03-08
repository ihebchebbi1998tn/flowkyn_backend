import { Response, NextFunction } from 'express';
import { EventsService } from '../services/events.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';

const eventsService = new EventsService();
const orgsService = new OrganizationsService();

export class EventsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await orgsService.getMemberByUserId(req.body.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const event = await eventsService.create(member.id, req.body);
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

  /**
   * Update event — requires org membership check.
   */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized to update this event' }); return; }
      const updated = await eventsService.update(req.params.eventId, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  }

  /**
   * Delete event — requires org membership check.
   */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized to delete this event' }); return; }
      const result = await eventsService.delete(req.params.eventId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized' }); return; }
      const result = await eventsService.inviteParticipant(req.params.eventId, member.id, req.body.email);
      res.json(result);
    } catch (err) { next(err); }
  }

  async join(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const result = await eventsService.join(req.params.eventId, member.id);
      res.json(result);
    } catch (err) { next(err); }
  }

  async leave(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      const result = await eventsService.leave(req.params.eventId, member.id);
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
