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
import { NotificationsService } from '../services/notifications.service';
import { EventProfilesService } from '../services/events-profiles.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { emitEventUpdate, emitEventNotification } from '../socket/emitter';
import { query, queryOne } from '../config/database';

const eventsService = new EventsService();
const invitationsService = new EventInvitationsService();
const messagesService = new EventMessagesService();
const orgsService = new OrganizationsService();
const notificationsService = new NotificationsService();
const audit = new AuditLogsService();
const profilesService = new EventProfilesService();

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

/** Get unified auth payload for event endpoints (supports both user JWT and guest token) */
function getEventAuthPayload(req: AuthRequest): { isGuest: boolean; userId?: string; participantId?: string; eventId?: string } | null {
  if (req.user) return { ...req.user, isGuest: false };
  if (req.guest) return { isGuest: true, participantId: req.guest.participantId, eventId: req.guest.eventId };
  return null;
}

/**
 * Verify the authenticated user owns a given participant_id.
 * Supports both org-member participants and guest participants.
 * Prevents impersonation in message/post/action endpoints.
 * 
 * For invited users (org members who haven't created a participant yet),
 * we allow them to post if they are:
 * 1. An invited member of the organization
 * 2. The participant belongs to that organization
 */
async function verifyParticipantOwnership(participantId: string, userPayload: any): Promise<void> {
  // Check guest participant
  if (userPayload.isGuest) {
    if (userPayload.participantId !== participantId) {
      throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
    }
    return;
  }

  // Check org-member participant
  const memberRow = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [participantId, userPayload.userId]
  );
  if (memberRow) return;

  // For invited users: check if they are a member of the organization that owns this event
  // and if the participant belongs to that same organization
  const orgMemberRow = await queryOne(
    `SELECT om.id FROM organization_members om
     WHERE om.user_id = $1`,
    [userPayload.userId]
  );
  
  if (orgMemberRow) {
    // User is an org member. Now check if the participant belongs to the same org
    const participantOrgRow = await queryOne(
      `SELECT p.id FROM participants p
       JOIN events e ON e.id = p.event_id
       WHERE p.id = $1 AND e.organization_id = (
         SELECT organization_id FROM organization_members WHERE user_id = $2 LIMIT 1
       )`,
      [participantId, userPayload.userId]
    );
    if (participantOrgRow) return;
  }

  // No match — user doesn't own this participant
  throw new AppError('You do not own this participant', 403, 'FORBIDDEN');
}

/**
 * Resolve the current participant_id for this event based on the authenticated user or guest token.
 */
async function requireCurrentParticipantId(eventId: string, userPayload: any): Promise<string> {
  // Guest: participant id is encoded in the guest token payload
  if (userPayload.isGuest) {
    if (userPayload.eventId !== eventId) {
      throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
    }
    return userPayload.participantId;
  }

  // Authenticated org member participant
  const row = await queryOne<{ id: string }>(
    `SELECT p.id
     FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL
     ORDER BY p.joined_at ASC NULLS LAST
     LIMIT 1`,
    [eventId, userPayload.userId],
  );

  if (!row) {
    throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
  }

  return row.id;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class EventsController {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** POST /events — Create a new event */
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as any;
      const member = await requireOrgMember(body.organization_id, req.user!.userId);
      requireAdminRole(member, 'create events');
      const event = await eventsService.create(member.id, body);
      await audit.create(body.organization_id, req.user!.userId, 'EVENT_CREATE', { eventId: event.id, title: body.title });

      // Automatically invite pre-selected members/emails if provided
      if (Array.isArray(body.invites) && body.invites.length > 0) {
        // Run invitations in parallel, silencing errors so one failure doesn't crash the whole creation flow
        await Promise.allSettled(
          body.invites.map((email: string) =>
            invitationsService.inviteParticipant(
              event.id,
              member.id,
              email,
              event.title,
              event.max_participants,
              'en', // Default to english if missing on payload
              body.game_id,
              event.start_time,
              event.end_time
            )
          )
        );
      }

      // Optional: notify the creator that the event was created successfully.
      // Failure to create the notification must not break event creation.
      try {
        await notificationsService.create(req.user!.userId, 'event_created', {
          event_id: event.id,
          title: event.title,
          organization_id: event.organization_id,
        });
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create event_created notification:', (notifErr as any)?.message);
      }

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

      const {
        allow_guests,
        allow_chat,
        auto_start_games,
        max_rounds,
        allow_participant_game_control,
        ...eventUpdates
      } = req.body as any;

      // Update core event fields (title, times, status, etc.)
      const updated = Object.keys(eventUpdates).length
        ? await eventsService.update(req.params.eventId, eventUpdates)
        : event;

      // Update event_settings if any setting fields were provided
      if (
        allow_guests !== undefined ||
        allow_chat !== undefined ||
        auto_start_games !== undefined ||
        max_rounds !== undefined ||
        allow_participant_game_control !== undefined
      ) {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (allow_guests !== undefined) {
          fields.push(`allow_guests = $${idx++}`);
          values.push(!!allow_guests);
        }
        if (allow_chat !== undefined) {
          fields.push(`allow_chat = $${idx++}`);
          values.push(!!allow_chat);
        }
        if (auto_start_games !== undefined) {
          fields.push(`auto_start_games = $${idx++}`);
          values.push(!!auto_start_games);
        }
        if (max_rounds !== undefined) {
          fields.push(`max_rounds = $${idx++}`);
          values.push(Number(max_rounds));
        }
        if (allow_participant_game_control !== undefined) {
          fields.push(`allow_participant_game_control = $${idx++}`);
          values.push(!!allow_participant_game_control);
        }

        if (fields.length > 0) {
          values.push(req.params.eventId);
          await query(
            `UPDATE event_settings SET ${fields.join(', ')}, updated_at = NOW()
             WHERE event_id = $${idx}`,
            values
          );
        }
      }

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
      // Delete first — only notify clients after the deletion is confirmed
      const result = await eventsService.delete(req.params.eventId);
      emitEventNotification(req.params.eventId, 'event:deleted', { eventId: req.params.eventId, title: event.title });
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_DELETE', { eventId: req.params.eventId, title: event.title });
      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Public Endpoints (no auth) ────────────────────────────────────────────

  /** GET /events/:eventId/public — Public event info for lobby */
  async getPublicInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const info = await eventsService.getPublicInfo(req.params.eventId);

      // For private events, avoid leaking organization identity and counts
      if (info.visibility === 'private') {
        const { organization_name, organization_logo, participant_count, invited_count, ...safe } = info as any;
        return res.json({
          ...safe,
          organization_name: null,
          organization_logo: null,
          participant_count: null,
          invited_count: null,
        });
      }

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
      const _req = req as any;
      const event = await eventsService.getById(_req.params.eventId);
      if (!event.allow_guests) {
        throw new AppError('Guests are not allowed for this event', 403, 'GUESTS_NOT_ALLOWED');
      }

      // Idempotency: If the client already has a valid active guest token, just return it.
      const authHeader = _req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        try {
          const { verifyGuestToken } = await import('../utils/jwt');
          const guestPayload = verifyGuestToken(token);
          if (guestPayload.eventId === _req.params.eventId) {
            const pt = await queryOne<{ id: string; guest_name: string }>(
              'SELECT id, guest_name FROM participants WHERE id = $1 AND left_at IS NULL',
              [guestPayload.participantId]
            );
            if (pt) {
              return res.status(200).json({
                participant_id: pt.id,
                guest_name: pt.guest_name || guestPayload.guestName,
                guest_token: token,
                already_joined: true
              });
            }
          }
        } catch (e) {
          // Ignore invalid/expired tokens and proceed to create a new one
        }
      }

      const result = await invitationsService.joinAsGuest(_req.params.eventId, _req.body, event);
      await audit.create(event.organization_id, null, 'EVENT_GUEST_JOIN', { eventId: req.params.eventId, guestName: result.guest_name, ip: req.ip });
      emitEventNotification(req.params.eventId, 'participant:joined', {
        guestName: result.guest_name,
        participantId: result.participant_id,
      });

      // Notify the event creator that a guest joined (if we can resolve a user_id).
      try {
        const creator = await queryOne<{ user_id: string }>(
          `SELECT om.user_id
           FROM organization_members om
           WHERE om.id = $1`,
          [event.created_by_member_id]
        );
        if (creator?.user_id) {
          await notificationsService.create(creator.user_id, 'event_participant_joined', {
            event_id: event.id,
            title: event.title,
            participant_id: result.participant_id,
            guest_name: result.guest_name,
          });
        }
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create guest join notification:', (notifErr as any)?.message);
      }

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

  /** GET /events/:eventId/participants — List participants (lobby) */
  async getParticipants(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      // For private events, only expose participant list to authenticated flows via lobby token.
      // The frontend already only calls this once it has a valid event token;
      // for unauthenticated callers without any context, treat private events as not found.
      if (event.visibility === 'private') {
        // Hide whether the event exists at all for completely unauthenticated callers.
        // Authenticated flows use /events/:id and /events/:id/me instead.
        throw new AppError('Event not found', 404, 'NOT_FOUND');
      }

      const result = await eventsService.getParticipants(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  /**
   * GET /events/:eventId/pinned-message — Get the currently pinned chat message for an event, if any.
   */
  async getPinnedMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      // Only query when there is a pinned message (LEFT JOIN + WHERE filters out NULL safely)
      const row = await queryOne<any>(
        `SELECT em.*,
                p.guest_name,
                p.participant_type,
                p.guest_avatar,
                u.id as user_id,
                COALESCE(ep.display_name, u.name, p.guest_name, 'Unknown') as user_name,
                COALESCE(ep.avatar_url, u.avatar_url, p.guest_avatar) as avatar_url
         FROM events e
         LEFT JOIN event_messages em ON em.id = e.pinned_message_id
         LEFT JOIN participants p ON p.id = em.participant_id
         LEFT JOIN event_profiles ep ON ep.event_id = em.event_id AND ep.participant_id = em.participant_id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE e.id = $1 AND e.pinned_message_id IS NOT NULL`,
        [eventId]
      );
      if (!row || !row.id) {
        res.json(null);
        return;
      }
      res.json(row);
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

      // Notify the user who accepted the invitation and the event creator.
      try {
        await notificationsService.create(req.user!.userId, 'event_joined', {
          event_id: event.id,
          title: event.title,
          participant_id: result.participant_id,
        });

        const creator = await queryOne<{ user_id: string }>(
          `SELECT om.user_id
           FROM organization_members om
           WHERE om.id = $1`,
          [event.created_by_member_id]
        );
        if (creator?.user_id && creator.user_id !== req.user!.userId) {
          await notificationsService.create(creator.user_id, 'event_participant_joined', {
            event_id: event.id,
            title: event.title,
            participant_id: result.participant_id,
            user_id: req.user!.userId,
          });
        }
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create join notifications (acceptInvitation):', (notifErr as any)?.message);
      }

      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/invitations — Send invitation email */
  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      requireAdminRole(member, 'invite participants');
      const result = await invitationsService.inviteParticipant(
        req.params.eventId,
        member.id,
        req.body.email,
        event.title,
        event.max_participants,
        req.body.lang,
        req.body.game_id,
        event.start_time ? String(event.start_time) : undefined,
        event.end_time ? String(event.end_time) : undefined
      );
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

      // Notify the joining user and the event creator.
      try {
        await notificationsService.create(req.user!.userId, 'event_joined', {
          event_id: event.id,
          title: event.title,
          participant_id: result.participant_id,
        });

        const creator = await queryOne<{ user_id: string }>(
          `SELECT om.user_id
           FROM organization_members om
           WHERE om.id = $1`,
          [event.created_by_member_id]
        );
        if (creator?.user_id && creator.user_id !== req.user!.userId) {
          await notificationsService.create(creator.user_id, 'event_participant_joined', {
            event_id: event.id,
            title: event.title,
            participant_id: result.participant_id,
            user_id: req.user!.userId,
          });
        }
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create join notifications (join):', (notifErr as any)?.message);
      }

      res.json(result);
    } catch (err) { next(err); }
  }

  /**
   * POST /events/:eventId/pin-message — Pin a chat message (any participant).
   */
  async pinMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');

      const { message_id } = req.body as { message_id: string };
      if (!message_id) throw new AppError('message_id is required', 400, 'VALIDATION_FAILED');

      // Must be a participant in this event (members or guests)
      await requireCurrentParticipantId(eventId, auth as any);

      // Ensure message belongs to this event
      const messageRow = await queryOne<{ id: string }>(
        `SELECT id FROM event_messages WHERE id = $1 AND event_id = $2`,
        [message_id, eventId]
      );
      if (!messageRow) throw new AppError('Message not found for this event', 404, 'NOT_FOUND');

      await query(
        `UPDATE events SET pinned_message_id = $1, updated_at = NOW() WHERE id = $2`,
        [message_id, eventId]
      );

      res.status(204).send();
    } catch (err) { next(err); }
  }

  /**
   * DELETE /events/:eventId/pin-message — Unpin the current pinned message (any participant).
   */
  async unpinMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');

      // Must be a participant in this event (members or guests)
      await requireCurrentParticipantId(eventId, auth as any);

      await query(
        `UPDATE events SET pinned_message_id = NULL, updated_at = NOW() WHERE id = $1`,
        [eventId]
      );

      res.status(204).send();
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

  /** GET /events/:eventId/me — Get the current participant identity for this event */
  async getMyParticipant(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;

      // Guest: ensure they belong to this event via guest token payload
      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) {
          throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
        }

        const row = await queryOne<{
          id: string;
          participant_type: string;
          guest_name: string | null;
          guest_avatar: string | null;
        }>(
          `SELECT id, participant_type, guest_name, guest_avatar
           FROM participants
           WHERE id = $1 AND event_id = $2 AND participant_type = 'guest' AND left_at IS NULL`,
          [userPayload.participantId, req.params.eventId]
        );

        if (!row) {
          throw new AppError('Participant not found', 404, 'NOT_FOUND');
        }

        return res.json({
          id: row.id,
          type: row.participant_type,
          name: row.guest_name,
          avatar: row.guest_avatar,
          isGuest: true,
        });
      }

      // Authenticated member: ensure they belong to the event's organization
      const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
      if (!member) {
        throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');
      }

      const participant = await queryOne<{
        id: string;
        participant_type: string;
        name: string;
        avatar: string | null;
      }>(
        `SELECT p.id, p.participant_type,
                COALESCE(u.name, p.guest_name, 'Unknown') as name,
                COALESCE(u.avatar_url, p.guest_avatar) as avatar
         FROM participants p
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL
         ORDER BY p.joined_at ASC NULLS LAST
         LIMIT 1`,
        [req.params.eventId, userPayload.userId]
      );

      if (!participant) {
        // Not a participant yet — return a 404 but with a clear semantic code
        throw new AppError('You are not a participant in this event', 404, 'NOT_PARTICIPANT');
      }

      return res.json({
        id: participant.id,
        type: participant.participant_type,
        name: participant.name,
        avatar: participant.avatar,
        isGuest: false,
      });
    } catch (err) {
      next(err);
    }
  }

  /** GET /events/:eventId/profile — Get current user's per-event profile (display name + avatar) */
  async getMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const participantId = await requireCurrentParticipantId(req.params.eventId, auth);
      try {
        const profile = await profilesService.getForParticipant(req.params.eventId, participantId);
        res.json({
          participant_id: participantId,
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        });
      } catch (err: any) {
        if (err?.code === 'PROFILE_NOT_FOUND') {
          // If no profile exists yet, return a sensible default without 404
          return res.json({
            participant_id: participantId,
            id: null,
            display_name: '',
            avatar_url: null,
          });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }

  /** PUT /events/:eventId/profile — Upsert current user's per-event profile */
  async upsertMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const { display_name, avatar_url } = req.body;
      if (!display_name || typeof display_name !== 'string') {
        throw new AppError('display_name is required', 400, 'VALIDATION_FAILED');
      }
      const participantId = await requireCurrentParticipantId(req.params.eventId, auth);
      const profile = await profilesService.upsertForParticipant(
        req.params.eventId,
        participantId,
        display_name.trim(),
        avatar_url || null,
      );
      res.json({
        participant_id: participantId,
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Messages & Posts ──────────────────────────────────────────────────────

  /** POST /events/:eventId/messages — Send a chat message */
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

  /** GET /events/:eventId/messages — Get paginated chat messages */
  async getMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;
      
      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) {
          throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
        }
      } else {
        const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
        if (!member) throw new AppError('You must be an organization member to view messages', 403, 'NOT_A_MEMBER');
      }
      
      const result = await messagesService.getMessages(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  /** GET /events/:eventId/posts — Get paginated activity posts */
  async getPosts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;

      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) {
          throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
        }
      } else {
        const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
        if (!member) throw new AppError('You must be an organization member to view posts', 403, 'NOT_A_MEMBER');
      }

      // Resolve the current participant so we can mark which reactions they have already added
      const participantId = await requireCurrentParticipantId(req.params.eventId, userPayload);
      const result = await messagesService.getPosts(req.params.eventId, req.query as any, participantId);
      res.json(result);
    } catch (err) { next(err); }
  }

  /** POST /events/:eventId/posts — Create an activity post */
  async createPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      await verifyParticipantOwnership(req.body.participant_id, auth);
      const result = await messagesService.createPost(req.params.eventId, req.body.participant_id, req.body.content);
      await audit.create(null, auth.userId ?? null, 'EVENT_CREATE_POST', { eventId: req.params.eventId, postId: result.id });
      emitEventNotification(req.params.eventId, 'post:created', {
        postId: result.id,
        authorId: auth.userId || auth.participantId,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }

  /** POST /posts/:postId/reactions — React to a post */
  async reactToPost(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      // Do NOT trust participant_id from the client. Derive the caller's participant id
      // from their auth token (guest token or user JWT) + the post's event_id.
      const postRow = await queryOne<{ event_id: string }>(
        'SELECT event_id FROM activity_posts WHERE id = $1',
        [req.params.postId]
      );
      if (!postRow) throw new AppError('Post not found', 404, 'NOT_FOUND');

      const participantId = await requireCurrentParticipantId(postRow.event_id, auth);
      const result = await messagesService.reactToPost(req.params.postId, participantId, req.body.reaction_type);
      await audit.create(null, auth.userId ?? null, 'EVENT_REACT_POST', { postId: req.params.postId, reactionType: req.body.reaction_type });

      // Best-effort real-time notification so async boards can refresh reactions
      try {
        if (postRow?.event_id) {
          emitEventNotification(postRow.event_id, 'post:reacted', {
            postId: req.params.postId,
            participantId,
            reactionType: req.body.reaction_type,
          });
        }
      } catch {
        // Non-fatal — API should still succeed even if socket emit fails
      }

      res.status(201).json(result);
    } catch (err) { next(err); }
  }
}
