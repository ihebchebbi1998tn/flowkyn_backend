/**
 * @fileoverview Events Controller
 *
 * HTTP request handler for all event endpoints. Delegates business logic
 * to three focused services:
 * - EventsService: CRUD, participants, public info
 * - EventInvitationsService: Token validation, invitation acceptance, guest join
 * - EventMessagesService: Chat messages, posts, reactions
 *
 * Authorization:
 * - Public routes: getPublicInfo, validateToken, joinAsGuest, getParticipants
 * - Authenticated routes: everything else (requires JWT via authenticate middleware)
 * - Role-based: create/update/delete/invite require owner/admin/moderator role
 */

import { Request, Response, NextFunction } from 'express';
import { EventsService } from '../services/events.service';
import { EventInvitationsService } from '../services/events-invitations.service';
import { EventMessagesService } from '../services/events-messages.service';
import { OrganizationsService } from '../services/organizations.service';
import { AuditLogsService } from '../services/auditLogs.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitEventUpdate, emitEventNotification } from '../socket/emitter';
import { queryOne } from '../config/database';

const eventsService = new EventsService();
const invitationsService = new EventInvitationsService();
const messagesService = new EventMessagesService();
const orgsService = new OrganizationsService();
const audit = new AuditLogsService();

// ─── Authorization Helpers ────────────────────────────────────────────────────

/**
 * Verify a user has an active membership in an org and return their role.
 * @throws {AppError} 403 if user is not an active member
 */
async function requireOrgMember(orgId: string, userId: string): Promise<{ id: string; role_name: string }> {
  const member = await queryOne<{ id: string; role_name: string }>(
    `SELECT om.id, r.name as role_name
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [orgId, userId]
  );
  if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
  return member;
}

/** Require owner, admin, or moderator role */
function requireAdminRole(member: { role_name: string }, action: string) {
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError(`You need owner, admin, or moderator role to ${action}`, 403, 'INSUFFICIENT_PERMISSIONS');
  }
}

/**
 * Verify the authenticated user owns a given participant_id.
 * Supports both org-member participants and guest participants.
 * Prevents impersonation in message/post/action endpoints.
 */
async function verifyParticipantOwnership(participantId: string, userId: string): Promise<void> {
  // Check org-member participant
  const memberRow = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [participantId, userId]
  );
  if (memberRow) return;

  // No match — user doesn't own this participant
  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class EventsController {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** POST /events — Create a new event */
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const member = await requireOrgMember(req.body.organization_id, req.user!.userId);
      requireAdminRole(member, 'create events');
      const event = await eventsService.create(member.id, req.body);
      await audit.create(req.body.organization_id, req.user!.userId, 'EVENT_CREATE', { eventId: event.id, title: req.body.title });
      res.status(201).json(event);
    } catch (err) { next(err); }
  }

  /** GET /events — List events for authenticated user */
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

  /** GET /events/:eventId — Get event details */
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

  /** PUT /events/:eventId — Update event fields */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      if (!['owner', 'admin', 'moderator'].includes(member.role_name) && member.id !== event.created_by_member_id) {
        throw new AppError('You need owner, admin, or moderator role to update this event', 403, 'INSUFFICIENT_PERMISSIONS');
      }
      const updated = await eventsService.update(req.params.eventId, req.body);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_UPDATE', { eventId: req.params.eventId, changes: Object.keys(req.body) });
      emitEventUpdate(req.params.eventId, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  }

  /** DELETE /events/:eventId — Delete event and all related data */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      if (!['owner', 'admin'].includes(member.role_name)) {
        throw new AppError('Only organization owners and admins can delete events', 403, 'INSUFFICIENT_PERMISSIONS');
      }
      emitEventNotification(req.params.eventId, 'event:deleted', { eventId: req.params.eventId, title: event.title });
      const result = await eventsService.delete(req.params.eventId);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_DELETE', { eventId: req.params.eventId, title: event.title });
      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Public Endpoints (no auth) ────────────────────────────────────────────

  /** GET /events/:eventId/public — Public event info for lobby */
  async getPublicInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const info = await eventsService.getPublicInfo(req.params.eventId);
      res.json(info);
    } catch (err) { next(err); }
  }

  /** GET /events/:eventId/validate-token — Validate invitation token */
  async validateToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.query.token as string;
      if (!token) throw new AppError('Token is required', 400, 'VALIDATION_FAILED');
      const invitation = await invitationsService.validateInvitationToken(req.params.eventId, token);
      res.json(invitation);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/join-guest — Guest join (no auth) */
  async joinAsGuest(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const result = await invitationsService.joinAsGuest(req.params.eventId, req.body, event);
      await audit.create(event.organization_id, null, 'EVENT_GUEST_JOIN', { eventId: req.params.eventId, guestName: result.guest_name, ip: req.ip });
      emitEventNotification(req.params.eventId, 'participant:joined', {
        guestName: result.guest_name,
        participantId: result.participant_id,
      });

      // Generate a guest token so the guest can participate in games and chat via REST/WebSocket
      const { signGuestToken } = await import('../utils/jwt');
      const guest_token = signGuestToken({
        participantId: result.participant_id,
        eventId: req.params.eventId,
        guestName: result.guest_name,
        isGuest: true,
      });

      res.status(201).json({ ...result, guest_token });
    } catch (err) { next(err); }
  }

  /** GET /events/:eventId/participants — List participants (no auth, for lobby) */
  async getParticipants(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventsService.getParticipants(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Participation ─────────────────────────────────────────────────────────

  /** POST /events/:eventId/accept-invitation — Accept invitation (auth required) */
  async acceptInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { token } = req.body;
      if (!token) throw new AppError('Token is required', 400, 'VALIDATION_FAILED');
      const event = await eventsService.getById(req.params.eventId);
      const result = await invitationsService.acceptInvitation(req.params.eventId, token, req.user!.userId, event);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_ACCEPT_INVITATION', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:joined', {
        userId: req.user!.userId,
        participantId: result.participant_id,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/invitations — Send invitation email */
  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      requireAdminRole(member, 'invite participants');
      const result = await invitationsService.inviteParticipant(req.params.eventId, member.id, req.body.email, event.title, event.max_participants, req.body.lang);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_INVITE', { eventId: req.params.eventId, invitedEmail: req.body.email });
      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/join — Join as org member */
  async join(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) throw new AppError('You must be an organization member to join this event', 403, 'NOT_A_MEMBER');
      const result = await eventsService.join(req.params.eventId, member.id);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_JOIN', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:joined', {
        userId: req.user!.userId,
        participantId: result.participant_id,
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/leave — Leave event */
  async leave(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      const result = await eventsService.leave(req.params.eventId, member.id);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_LEAVE', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:left', { userId: req.user!.userId });
      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Messages & Posts ──────────────────────────────────────────────────────

  /** POST /events/:eventId/messages — Send a chat message */
  async sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
      const result = await messagesService.sendMessage(req.params.eventId, req.body.participant_id, req.body.message);
      await audit.create(null, req.user!.userId, 'EVENT_SEND_MESSAGE', { eventId: req.params.eventId, messageId: result.id });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  /** GET /events/:eventId/messages — Get paginated chat messages */
  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) throw new AppError('You must be an organization member to view messages', 403, 'NOT_A_MEMBER');
      const result = await messagesService.getMessages(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/posts — Create an activity post */
  async createPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
      const result = await messagesService.createPost(req.params.eventId, req.body.participant_id, req.body.content);
      await audit.create(null, req.user!.userId, 'EVENT_CREATE_POST', { eventId: req.params.eventId, postId: result.id });
      emitEventNotification(req.params.eventId, 'post:created', {
        postId: result.id,
        authorId: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  /** POST /posts/:postId/reactions — React to a post */
  async reactToPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await verifyParticipantOwnership(req.body.participant_id, req.user!.userId);
      const result = await messagesService.reactToPost(req.params.postId, req.body.participant_id, req.body.reaction_type);
      await audit.create(null, req.user!.userId, 'EVENT_REACT_POST', { postId: req.params.postId, reactionType: req.body.reaction_type });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
}
