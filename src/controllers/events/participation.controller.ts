/**
 * Events Controller — Participation (join, leave, invite, accept, pin, profiles, getParticipants, me)
 */
import { Request, Response, NextFunction } from 'express';
import { EventsService } from '../../services/events.service';
import { EventInvitationsService } from '../../services/events-invitations.service';
import { EventProfilesService } from '../../services/events-profiles.service';
import { OrganizationsService } from '../../services/organizations.service';
import { AuditLogsService } from '../../services/auditLogs.service';
import { NotificationsService } from '../../services/notifications.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { emitEventNotification, emitGameUpdate } from '../../socket/emitter';
import { getIO } from '../../socket/index';
import { query, queryOne } from '../../config/database';
import { requireOrgMember, getEventAuthPayload, requireCurrentParticipantId } from './helpers';

const eventsService = new EventsService();
const invitationsService = new EventInvitationsService();
const orgsService = new OrganizationsService();
const notificationsService = new NotificationsService();
const audit = new AuditLogsService();
const profilesService = new EventProfilesService();

export class EventsParticipationController {
  async validateToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.query.token as string;
      if (!token) throw new AppError('Token is required', 400, 'VALIDATION_FAILED');
      const invitation = await invitationsService.validateInvitationToken(req.params.eventId, token);
      res.json(invitation);
    } catch (err) { next(err); }
  }

  async joinAsGuest(req: Request, res: Response, next: NextFunction) {
    try {
      const _req = req as any;
      const event = await eventsService.getById(_req.params.eventId);

      if (event.allow_guests === false) {
        throw new AppError('Guests are not allowed for this event', 403, 'GUESTS_NOT_ALLOWED');
      }

      const authHeader = _req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        try {
          const { verifyGuestToken } = await import('../../utils/jwt');
          const guestPayload = verifyGuestToken(token);
          if (guestPayload.eventId === _req.params.eventId) {
            const pt = await queryOne<{ id: string; guest_name: string; guest_identity_key: string | null }>(
              'SELECT id, guest_name, guest_identity_key FROM participants WHERE id = $1 AND left_at IS NULL',
              [guestPayload.participantId]
            );
            if (pt) {
              const incomingIdentityKey = typeof _req.body?.guest_identity_key === 'string' ? _req.body.guest_identity_key : null;
              if (incomingIdentityKey && !pt.guest_identity_key) {
                await query(
                  `UPDATE participants SET guest_identity_key = $1 WHERE id = $2 AND participant_type = 'guest' AND left_at IS NULL`,
                  [incomingIdentityKey, pt.id]
                );
              }
              const displayRow = await queryOne<{ display_name: string | null }>(
                `SELECT ep.display_name FROM event_profiles ep WHERE ep.event_id = $1 AND ep.participant_id = $2`,
                [_req.params.eventId, pt.id]
              );
              const currentGuestName = (displayRow?.display_name || pt.guest_name || guestPayload.guestName || 'Guest').trim() || 'Guest';
              const { signGuestToken } = await import('../../utils/jwt');
              const fresh_token = signGuestToken({
                participantId: pt.id, eventId: _req.params.eventId, guestName: currentGuestName,
                guestIdentityKey: incomingIdentityKey || undefined, isGuest: true,
              });
              return res.status(200).json({ participant_id: pt.id, guest_name: currentGuestName, guest_token: fresh_token, already_joined: true });
            }
          }
        } catch (e) { /* ignore invalid tokens */ }
      }

      const result = await invitationsService.joinAsGuest(_req.params.eventId, _req.body, event);
      if (!result.already_joined) {
        await audit.create(event.organization_id, null, 'EVENT_GUEST_JOIN', { eventId: req.params.eventId, guestName: result.guest_name, ip: req.ip });
        emitEventNotification(req.params.eventId, 'participant:joined', { guestName: result.guest_name, participantId: result.participant_id });
      }

      if (!result.already_joined) {
        try {
          const creator = await queryOne<{ user_id: string }>(
            `SELECT om.user_id FROM organization_members om WHERE om.id = $1`,
            [event.created_by_member_id]
          );
          if (creator?.user_id) {
            await notificationsService.create(creator.user_id, 'event_participant_joined', {
              event_id: event.id, title: event.title, participant_id: result.participant_id, guest_name: result.guest_name,
            });
          }
        } catch (notifErr) {
          console.warn('[EventsController] Failed to create guest join notification:', (notifErr as any)?.message);
        }
      }

      const { signGuestToken } = await import('../../utils/jwt');
      const guest_token = signGuestToken({
        participantId: result.participant_id, eventId: req.params.eventId, guestName: result.guest_name,
        guestIdentityKey: typeof _req.body?.guest_identity_key === 'string' ? _req.body.guest_identity_key : undefined,
        isGuest: true,
      });

      res.status(result.already_joined ? 200 : 201).json({ ...result, guest_token });
    } catch (err) {
      console.error('[EventsController] joinAsGuest error:', (err as any)?.message, (err as any)?.stack?.split('\n').slice(0, 3).join('\n'));
      next(err);
    }
  }

  async getParticipants(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      if (event.visibility === 'private') {
        throw new AppError('Event not found', 404, 'NOT_FOUND');
      }
      const result = await eventsService.getParticipants(req.params.eventId, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  }

  async getPinnedMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const row = await queryOne<any>(
        `SELECT em.*,
                p.guest_name, p.participant_type, p.guest_avatar,
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
      if (!row || !row.id) { res.json(null); return; }
      res.json(row);
    } catch (err) { next(err); }
  }

  async acceptInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { token } = req.body;
      if (!token) throw new AppError('Token is required', 400, 'VALIDATION_FAILED');
      const event = await eventsService.getById(req.params.eventId);
      const result = await invitationsService.acceptInvitation(req.params.eventId, token, req.user!.userId, event);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_ACCEPT_INVITATION', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:joined', { userId: req.user!.userId, participantId: result.participant_id });

      try {
        await notificationsService.create(req.user!.userId, 'event_joined', { event_id: event.id, title: event.title, participant_id: result.participant_id });
        const creator = await queryOne<{ user_id: string }>(`SELECT om.user_id FROM organization_members om WHERE om.id = $1`, [event.created_by_member_id]);
        if (creator?.user_id && creator.user_id !== req.user!.userId) {
          await notificationsService.create(creator.user_id, 'event_participant_joined', { event_id: event.id, title: event.title, participant_id: result.participant_id, user_id: req.user!.userId });
        }
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create join notifications (acceptInvitation):', (notifErr as any)?.message);
      }
      res.json(result);
    } catch (err) { next(err); }
  }

  async invite(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await requireOrgMember(event.organization_id, req.user!.userId);
      const { requireAdminRole } = await import('./helpers');
      requireAdminRole(member, 'invite participants');

      let gameTypeKey: string | undefined;
      if (!req.body.game_id) {
        const gameSession = await queryOne<{ key: string }>(
          `SELECT gt.key FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id
           WHERE gs.event_id = $1 AND gs.status != 'finished' ORDER BY gs.created_at DESC LIMIT 1`,
          [req.params.eventId]
        );
        gameTypeKey = gameSession?.key;
      }

      const result = await invitationsService.inviteParticipant(
        req.params.eventId, member.id, req.body.email, event.title, event.max_participants,
        req.body.lang, req.body.game_id || gameTypeKey,
        event.start_time ? String(event.start_time) : undefined,
        event.end_time ? String(event.end_time) : undefined
      );
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_INVITE', { eventId: req.params.eventId, invitedEmail: req.body.email });
      res.json(result);
    } catch (err) { next(err); }
  }

  async join(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const event = await eventsService.getById(req.params.eventId);
      const member = await orgsService.getMemberByUserId(event.organization_id, req.user!.userId);
      if (!member) throw new AppError('You must be an organization member to join this event', 403, 'NOT_A_MEMBER');
      const result = await eventsService.join(req.params.eventId, member.id);
      await audit.create(event.organization_id, req.user!.userId, 'EVENT_JOIN', { eventId: req.params.eventId });
      emitEventNotification(req.params.eventId, 'participant:joined', { userId: req.user!.userId, participantId: result.participant_id });

      try {
        await notificationsService.create(req.user!.userId, 'event_joined', { event_id: event.id, title: event.title, participant_id: result.participant_id });
        const creator = await queryOne<{ user_id: string }>(`SELECT om.user_id FROM organization_members om WHERE om.id = $1`, [event.created_by_member_id]);
        if (creator?.user_id && creator.user_id !== req.user!.userId) {
          await notificationsService.create(creator.user_id, 'event_participant_joined', { event_id: event.id, title: event.title, participant_id: result.participant_id, user_id: req.user!.userId });
        }
      } catch (notifErr) {
        console.warn('[EventsController] Failed to create join notifications (join):', (notifErr as any)?.message);
      }
      res.json(result);
    } catch (err) { next(err); }
  }

  async pinMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const { message_id } = req.body as { message_id: string };
      if (!message_id) throw new AppError('message_id is required', 400, 'VALIDATION_FAILED');
      await requireCurrentParticipantId(eventId, auth as any);
      const messageRow = await queryOne<{ id: string }>(`SELECT id FROM event_messages WHERE id = $1 AND event_id = $2`, [message_id, eventId]);
      if (!messageRow) throw new AppError('Message not found for this event', 404, 'NOT_FOUND');
      await query(`UPDATE events SET pinned_message_id = $1, updated_at = NOW() WHERE id = $2`, [message_id, eventId]);
      res.status(204).send();
    } catch (err) { next(err); }
  }

  async unpinMessage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const eventId = req.params.eventId;
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      await requireCurrentParticipantId(eventId, auth as any);
      await query(`UPDATE events SET pinned_message_id = NULL, updated_at = NOW() WHERE id = $1`, [eventId]);
      res.status(204).send();
    } catch (err) { next(err); }
  }

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

  async getMyParticipant(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const event = await eventsService.getById(req.params.eventId);
      const userPayload: any = auth;

      if (userPayload.isGuest) {
        if (userPayload.eventId !== req.params.eventId) {
          throw new AppError('You are not a participant in this event', 403, 'NOT_PARTICIPANT');
        }
        const participantId = await requireCurrentParticipantId(req.params.eventId, userPayload);
        const row = await queryOne<{ id: string; participant_type: string; guest_name: string | null; guest_avatar: string | null }>(
          `SELECT id, participant_type, guest_name, guest_avatar FROM participants WHERE id = $1 AND event_id = $2 AND participant_type = 'guest' AND left_at IS NULL`,
          [participantId, req.params.eventId]
        );
        if (!row) throw new AppError('Participant not found', 404, 'NOT_FOUND');
        return res.json({ id: row.id, type: row.participant_type, name: row.guest_name, avatar: row.guest_avatar, isGuest: true });
      }

      const member = await orgsService.getMemberByUserId(event.organization_id, userPayload.userId);
      if (!member) throw new AppError('You are not a member of this organization', 403, 'NOT_A_MEMBER');

      const participant = await queryOne<{ id: string; participant_type: string; name: string; avatar: string | null }>(
        `SELECT p.id, p.participant_type,
                COALESCE(u.name, p.guest_name, 'Unknown') as name,
                COALESCE(u.avatar_url, p.guest_avatar) as avatar
         FROM participants p
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE p.event_id = $1 AND om.user_id = $2 AND p.left_at IS NULL
         ORDER BY p.joined_at ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC LIMIT 1`,
        [req.params.eventId, userPayload.userId]
      );
      if (!participant) throw new AppError('You are not a participant in this event', 404, 'NOT_PARTICIPANT');
      return res.json({ id: participant.id, type: participant.participant_type, name: participant.name, avatar: participant.avatar, isGuest: false });
    } catch (err) { next(err); }
  }

  async getMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const participantId = await requireCurrentParticipantId(req.params.eventId, auth);
      try {
        const profile = await profilesService.getForParticipant(req.params.eventId, participantId);
        res.json({ participant_id: participantId, id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url });
      } catch (err: any) {
        if (err?.code === 'PROFILE_NOT_FOUND') {
          return res.json({ participant_id: participantId, id: null, display_name: '', avatar_url: null });
        }
        throw err;
      }
    } catch (err) { next(err); }
  }

  async upsertMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const auth = getEventAuthPayload(req);
      if (!auth) throw new AppError('Authentication required', 401, 'AUTH_TOKEN_INVALID');
      const { display_name, avatar_url } = req.body;
      if (!display_name || typeof display_name !== 'string') throw new AppError('display_name is required', 400, 'VALIDATION_FAILED');
      const participantId = await requireCurrentParticipantId(req.params.eventId, auth);
      const profile = await profilesService.upsertForParticipant(req.params.eventId, participantId, display_name.trim(), avatar_url || null);

      const profileUpdatePayload = {
        eventId: req.params.eventId, participantId,
        displayName: profile.display_name, avatarUrl: profile.avatar_url,
        updatedAt: new Date().toISOString(),
      };

      try {
        const io = getIO();
        io.of('/events').to(`event:${req.params.eventId}`).emit('event:participant_profile_updated', profileUpdatePayload);
      } catch { /* non-fatal */ }

      try {
        const activeSessions = await query<{ id: string }>(`SELECT id FROM game_sessions WHERE event_id = $1 AND status = 'active'`, [req.params.eventId]);
        for (const session of activeSessions) {
          emitGameUpdate(session.id, 'game:participant_profile_updated', profileUpdatePayload);
        }
      } catch (emitErr) {
        console.warn('[EventsController] Failed to emit game profile update', {
          eventId: req.params.eventId, participantId,
          error: emitErr instanceof Error ? emitErr.message : String(emitErr),
        });
      }

      res.json({ participant_id: participantId, id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url });
    } catch (err) { next(err); }
  }
}
