/**
 * Events Controller — CRUD operations (create, list, getById, update, delete)
 */
import { Request, Response, NextFunction } from 'express';
import { EventsService } from '../../services/events.service';
import { OrganizationsService } from '../../services/organizations.service';
import { AuditLogsService } from '../../services/auditLogs.service';
import { NotificationsService } from '../../services/notifications.service';
import { EventInvitationsService } from '../../services/events-invitations.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { emitEventUpdate, emitEventNotification } from '../../socket/emitter';
import { query } from '../../config/database';
import { requireOrgMember, requireAdminRole } from './helpers';

const eventsService = new EventsService();
const invitationsService = new EventInvitationsService();
const orgsService = new OrganizationsService();
const notificationsService = new NotificationsService();
const audit = new AuditLogsService();

export class EventsCrudController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as any;
      const member = await requireOrgMember(body.organization_id, req.user!.userId);
      requireAdminRole(member, 'create events');
      const event = await eventsService.create(member.id, body);
      await audit.create(body.organization_id, req.user!.userId, 'EVENT_CREATE', { eventId: event.id, title: body.title });

      const inviteEmails = new Set<string>();
      if (Array.isArray(body.invite_department_ids) && body.invite_department_ids.length > 0) {
        const emails = await orgsService.listEmailsByDepartments(event.organization_id, body.invite_department_ids);
        for (const email of emails) inviteEmails.add(email);
      }
      if (Array.isArray(body.invites) && body.invites.length > 0) {
        for (const email of body.invites) inviteEmails.add(email);
      }

      const inviteEmailList = Array.from(inviteEmails);
      if (inviteEmailList.length > 0) {
        const emailLang = typeof body.lang === 'string' ? body.lang : (req.user as any)?.language || 'en';
        await Promise.allSettled(
          inviteEmailList.map((email: string) =>
            invitationsService.inviteParticipant(event.id, member.id, email, event.title, event.max_participants, emailLang, body.game_id, event.start_time, event.end_time)
          )
        );
      }

      try {
        await notificationsService.create(req.user!.userId, 'event_created', {
          event_id: event.id, title: event.title, organization_id: event.organization_id,
        });
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create event_created notification:', (notifErr as any)?.message);
      }

      res.status(201).json(event);
    } catch (err) { next(err); }
  }

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const orgId = req.query.organization_id as string | undefined;
      if (orgId) {
        const member = await orgsService.getMemberByUserId(orgId, req.user!.userId);
        if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      }
      const result = await eventsService.list(req.query as any, orgId, req.user!.userId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      if (event.visibility === 'private') {
        const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
        if (!member) throw new AppError('This is a private event — you need to be an organization member', 403, 'FORBIDDEN');
      }
      res.json(event);
    } catch (err) { next(err); }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      if (!['owner', 'admin', 'moderator'].includes(member.role_name) && member.id !== event.created_by_member_id) {
        throw new AppError('You need owner, admin, or moderator role to update this event', 403, 'INSUFFICIENT_PERMISSIONS');
      }

      const {
        allow_guests, allow_chat, auto_start_games, max_rounds,
        default_session_duration_minutes, two_truths_submit_seconds, two_truths_vote_seconds,
        coffee_chat_duration_minutes, strategic_discussion_duration_minutes,
        ...eventUpdates
      } = req.body as any;

      const updated = Object.keys(eventUpdates).length
        ? await eventsService.update(req.params.eventId, eventUpdates)
        : event;

      if (
        allow_guests !== undefined || allow_chat !== undefined || auto_start_games !== undefined ||
        max_rounds !== undefined || default_session_duration_minutes !== undefined ||
        two_truths_submit_seconds !== undefined || two_truths_vote_seconds !== undefined ||
        coffee_chat_duration_minutes !== undefined || strategic_discussion_duration_minutes !== undefined
      ) {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (allow_guests !== undefined) { fields.push(`allow_guests = $${idx++}`); values.push(!!allow_guests); }
        if (allow_chat !== undefined) { fields.push(`allow_chat = $${idx++}`); values.push(!!allow_chat); }
        if (auto_start_games !== undefined) { fields.push(`auto_start_games = $${idx++}`); values.push(!!auto_start_games); }
        if (max_rounds !== undefined) { fields.push(`max_rounds = $${idx++}`); values.push(Number(max_rounds)); }
        if (default_session_duration_minutes !== undefined) { fields.push(`default_session_duration_minutes = $${idx++}`); values.push(Number(default_session_duration_minutes)); }
        if (two_truths_submit_seconds !== undefined) { fields.push(`two_truths_submit_seconds = $${idx++}`); values.push(Number(two_truths_submit_seconds)); }
        if (two_truths_vote_seconds !== undefined) { fields.push(`two_truths_vote_seconds = $${idx++}`); values.push(Number(two_truths_vote_seconds)); }
        if (coffee_chat_duration_minutes !== undefined) { fields.push(`coffee_chat_duration_minutes = $${idx++}`); values.push(Number(coffee_chat_duration_minutes)); }
        if (strategic_discussion_duration_minutes !== undefined) { fields.push(`strategic_discussion_duration_minutes = $${idx++}`); values.push(Number(strategic_discussion_duration_minutes)); }

        if (fields.length > 0) {
          values.push(req.params.eventId);
          await query(`UPDATE event_settings SET ${fields.join(', ')}, updated_at = NOW() WHERE event_id = $${idx}`, values);
        }
      }

      await audit.create(event.organization_id, req.user!.userId, 'EVENT_UPDATE', { eventId: req.params.eventId, changes: Object.keys(req.body) });
      emitEventUpdate(req.params.eventId, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  }

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      if (!['owner', 'admin'].includes(member.role_name)) {
        throw new AppError('Only organization owners and admins can delete events', 403, 'INSUFFICIENT_PERMISSIONS');
      }
      const result = await eventsService.delete(req.params.eventId);
      emitEventNotification(req.params.eventId, 'event:deleted', { eventId: req.params.eventId, title: event.title });
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_DELETE', { eventId: req.params.eventId, title: event.title });
      res.json(result);
    } catch (err) { next(err); }
  }

  async getPublicInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const info = await eventsService.getPublicInfo(req.params.eventId);
      if (info.visibility === 'private') {
        const { organization_name, organization_logo, participant_count, invited_count, ...safe } = info as any;
        return res.json({ ...safe, organization_name: null, organization_logo: null, participant_count: null, invited_count: null });
      }
      res.json(info);
    } catch (err) { next(err); }
  }
}
