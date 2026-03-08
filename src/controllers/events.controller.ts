import { Response, NextFunction } from 'express';
import { EventsService } from '../services/events.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitEventUpdate, emitEventNotification } from '../socket/emitter';
import { queryOne } from '../config/database';

const eventsService = new EventsService();
const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

/** Check if a member has admin-level role in an org */
async function requireOrgAdminForEvent(orgId: string, userId: string): Promise<{ id: string; role_name: string }> {
  const member = await queryOne<{ id: string; role_name: string }>(
    `SELECT om.id, r.name as role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [orgId, userId]
  );
  if (!member) throw new AppError('Not a member of this organization', 403);
  return member;
}

/** Verify the authenticated user owns the given participant_id */
async function verifyParticipantOwnership(participantId: string, userId: string): Promise<void> {
  const row = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [participantId, userId]
  );
  if (!row) throw new AppError('You do not own this participant', 403);
}

export class EventsController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await requireOrgAdminForEvent(req.body.organization_id, req.user!.userId);
      // Only owner/admin/moderator can create events
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        res.status(403).json({ error: 'Insufficient permissions to create events' }); return;
      }
      const event = await eventsService.create(member.id, req.body);
      await audit.create(req.body.organization_id, req.user!.userId, 'EVENT_CREATE', { eventId: event.id, title: req.body.title });
      res.status(201).json(event);
    } catch (err) { next(err); }
  }

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const orgId = req.query.organization_id as string | undefined;
      // If filtering by org, verify membership
      if (orgId) {
        const member = await orgsService.getMemberByUserId(orgId, req.user!.userId);
        if (!member) { res.status(403).json({ error: 'Not a member' }); return; }
      }
      const result = await eventsService.list(req.query as any, orgId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      // Public events can be viewed by anyone, private require membership
      if (event.visibility === 'private') {
        const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
        if (!member) { res.status(403).json({ error: 'Not authorized' }); return; }
      }
      res.json(event);
    } catch (err) { next(err); }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgAdminForEvent(event.organization_id, req.user!.userId);
      // SECURITY: Only owner/admin/moderator or the event creator can update
      if (!['owner', 'admin', 'moderator'].includes(member.role_name) && member.id !== event.created_by_member_id) {
        res.status(403).json({ error: 'Insufficient permissions to update this event' }); return;
      }
      const updated = await eventsService.update(req.params.eventId, req.body);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_UPDATE', { eventId: req.params.eventId, changes: Object.keys(req.body) });
      emitEventUpdate(req.params.eventId, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  }

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgAdminForEvent(event.organization_id, req.user!.userId);
      // SECURITY: Only owner/admin can delete events
      if (!['owner', 'admin'].includes(member.role_name)) {
        res.status(403).json({ error: 'Insufficient permissions to delete events' }); return;
      }
      emitEventNotification(req.params.eventId, 'event:deleted', { eventId: req.params.eventId, title: event.title });
      const result = await eventsService.delete(req.params.eventId);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_DELETE', { eventId: req.params.eventId, title: event.title });
      res.json(result);
    } catch (err) { next(err); }
  }

  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgAdminForEvent(event.organization_id, req.user!.userId);
      if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
        res.status(403).json({ error: 'Insufficient permissions' }); return;
      }
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
      // SECURITY: Verify the user owns the participant_id they claim
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
      const result = await eventsService.sendMessage(req.params.eventId, req.body.participant_id, req.body.message);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Verify user is a member of the event's org
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) { res.status(403).json({ error: 'Not authorized' }); return; }
      const result = await eventsService.getMessages(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  async createPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // SECURITY: Verify the user owns the participant_id
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
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
      // SECURITY: Verify the user owns the participant_id
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
      const result = await eventsService.reactToPost(req.params.postId, req.body.participant_id, req.body.reaction_type);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
}
