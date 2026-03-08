import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { EventRow, ParticipantRow } from '../types';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { sanitizeText } from '../utils/sanitize';
import { env } from '../config/env';
import crypto from 'crypto';

// Whitelist of allowed update fields to prevent SQL injection
const ALLOWED_EVENT_UPDATE_FIELDS = new Set([
  'title', 'description', 'event_mode', 'visibility',
  'max_participants', 'start_time', 'end_time', 'status',
]);

export class EventsService {
  async create(memberId: string, data: {
    organization_id: string; title: string; description?: string;
    event_mode?: string; visibility?: string; max_participants?: number;
    start_time?: string; end_time?: string;
  }) {
    const eventId = uuid();

    const event = await transaction(async (client) => {
      const { rows: [ev] } = await client.query(
        `INSERT INTO events (id, organization_id, created_by_member_id, title, description, event_mode, visibility, max_participants, start_time, end_time, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', NOW(), NOW()) RETURNING *`,
        [eventId, data.organization_id, memberId, data.title, data.description || '',
         data.event_mode || 'sync', data.visibility || 'private', data.max_participants || 50,
         data.start_time || null, data.end_time || null]
      );
      await client.query(
        `INSERT INTO event_settings (event_id, allow_guests, allow_chat, auto_start_games, max_rounds)
         VALUES ($1, true, true, false, 5)`,
        [eventId]
      );
      return ev;
    });

    return event;
  }

  async getById(eventId: string) {
    const event = await queryOne<EventRow>(
      `SELECT e.*, es.allow_guests, es.allow_chat, es.auto_start_games, es.max_rounds
       FROM events e LEFT JOIN event_settings es ON es.event_id = e.id
       WHERE e.id = $1`,
      [eventId]
    );
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
    return event;
  }

  /**
   * Public event info — no auth required. Returns only safe fields.
   * Used by the lobby page for guests and invited users.
   */
  async getPublicInfo(eventId: string) {
    const event = await queryOne<any>(
      `SELECT e.id, e.title, e.description, e.event_mode, e.visibility,
              e.max_participants, e.start_time, e.end_time, e.status,
              e.created_at, es.allow_guests,
              o.name as organization_name, o.logo_url as organization_logo
       FROM events e
       LEFT JOIN event_settings es ON es.event_id = e.id
       LEFT JOIN organizations o ON o.id = e.organization_id
       WHERE e.id = $1`,
      [eventId]
    );
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

    // Get participant count
    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );

    return {
      ...event,
      participant_count: parseInt(count),
    };
  }

  /**
   * Validate an invitation token and return event + invitation info.
   */
  async validateInvitationToken(eventId: string, token: string) {
    const invitation = await queryOne<any>(
      `SELECT ei.id, ei.email, ei.status, ei.expires_at, ei.created_at,
              e.title as event_title, e.description as event_description,
              e.event_mode, e.status as event_status,
              o.name as organization_name
       FROM event_invitations ei
       JOIN events e ON e.id = ei.event_id
       JOIN organizations o ON o.id = e.organization_id
       WHERE ei.event_id = $1 AND ei.token = $2`,
      [eventId, token]
    );
    if (!invitation) throw new AppError('Invalid or expired invitation', 404, 'NOT_FOUND');

    if (invitation.status === 'accepted') {
      throw new AppError('This invitation has already been accepted', 400, 'CONFLICT');
    }
    if (invitation.status === 'revoked') {
      throw new AppError('This invitation has been revoked', 400, 'FORBIDDEN');
    }
    if (new Date(invitation.expires_at) < new Date()) {
      throw new AppError('This invitation has expired', 400, 'AUTH_VERIFICATION_EXPIRED');
    }

    return invitation;
  }

  /**
   * Accept an invitation (for logged-in users).
   * Validates token, creates participant, marks invitation as accepted.
   */
  async acceptInvitation(eventId: string, token: string, userId: string) {
    const invitation = await this.validateInvitationToken(eventId, token);
    const event = await this.getById(eventId);

    return await transaction(async (client) => {
      // Check participant limit
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      // Find or create org membership (invited users may not be org members yet)
      let member = await queryOne<{ id: string }>(
        `SELECT om.id FROM organization_members om WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
        [event.organization_id, userId]
      );

      if (!member) {
        // Auto-add as 'member' role in the org
        const memberRole = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE name = 'member'`);
        if (!memberRole) throw new AppError('Default member role not found', 500, 'INTERNAL_ERROR');

        const memberId = uuid();
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role_id, status, joined_at, created_at)
           VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())`,
          [memberId, event.organization_id, userId, memberRole.id]
        );
        member = { id: memberId };
      }

      // Check not already participating
      const existing = await queryOne(
        'SELECT id FROM participants WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL',
        [eventId, member.id]
      );
      if (existing) {
        // Already joined, just mark invitation as accepted
        await client.query(
          `UPDATE event_invitations SET status = 'accepted' WHERE event_id = $1 AND token = $2`,
          [eventId, token]
        );
        return { participant_id: existing.id, already_joined: true };
      }

      // Create participant
      const participantId = uuid();
      await client.query(
        `INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
         VALUES ($1, $2, $3, 'member', NOW(), NOW())`,
        [participantId, eventId, member.id]
      );

      // Mark invitation as accepted
      await client.query(
        `UPDATE event_invitations SET status = 'accepted' WHERE event_id = $1 AND token = $2`,
        [eventId, token]
      );

      return { participant_id: participantId, already_joined: false };
    });
  }

  /**
   * Join as guest — no auth required.
   * Validates invitation token, creates a guest participant.
   */
  async joinAsGuest(eventId: string, data: { name: string; email?: string; avatar_url?: string; token?: string }) {
    const event = await this.getById(eventId);

    // Check if guests are allowed
    if (!(event as any).allow_guests) {
      throw new AppError('This event does not allow guest participants', 403, 'FORBIDDEN');
    }

    // If a token is provided, validate it
    if (data.token) {
      await this.validateInvitationToken(eventId, data.token);
    } else if (event.visibility === 'private') {
      throw new AppError('A valid invitation token is required to join this private event', 403, 'FORBIDDEN');
    }

    return await transaction(async (client) => {
      // Check participant limit
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      const participantId = uuid();
      const sanitizedName = sanitizeText(data.name, 100);
      if (sanitizedName.length === 0) throw new AppError('Name is required', 400, 'VALIDATION_FAILED');

      await client.query(
        `INSERT INTO participants (id, event_id, guest_name, guest_avatar, participant_type, joined_at, created_at)
         VALUES ($1, $2, $3, $4, 'guest', NOW(), NOW())`,
        [participantId, eventId, sanitizedName, data.avatar_url || null]
      );

      // Mark invitation as accepted if token was provided
      if (data.token) {
        await client.query(
          `UPDATE event_invitations SET status = 'accepted' WHERE event_id = $1 AND token = $2`,
          [eventId, data.token]
        );
      }

      return { participant_id: participantId, guest_name: sanitizedName };
    });
  }

  /**
   * List participants for an event (for lobby display).
   */
  async getParticipants(eventId: string, pagination?: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination || {});

    const [data, [{ count }]] = await Promise.all([
      query<any>(
        `SELECT p.id, p.participant_type, p.guest_name, p.guest_avatar, p.joined_at, p.created_at,
                u.name as user_name, u.avatar_url as user_avatar, u.email as user_email,
                om.id as member_id
         FROM participants p
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE p.event_id = $1 AND p.left_at IS NULL
         ORDER BY p.joined_at ASC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [eventId, limit, offset]
      ),
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      ),
    ]);

    // Map to a clean response (hide internal IDs for guests)
    const participants = data.map((p: any) => ({
      id: p.id,
      type: p.participant_type,
      name: p.participant_type === 'guest' ? p.guest_name : p.user_name,
      avatar: p.participant_type === 'guest' ? p.guest_avatar : p.user_avatar,
      email: p.participant_type === 'guest' ? null : p.user_email,
      joined_at: p.joined_at,
    }));

    return buildPaginatedResponse(participants, parseInt(count), page, limit);
  }

  async list(pagination: { page?: number; limit?: number }, orgId?: string, userId?: string) {
    const { page, limit, offset } = parsePagination(pagination);

    if (orgId) {
      const [data, [{ count }]] = await Promise.all([
        query<EventRow>(
          `SELECT * FROM events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [orgId, limit, offset]
        ),
        query<{ count: string }>(`SELECT COUNT(*) as count FROM events WHERE organization_id = $1`, [orgId]),
      ]);
      return buildPaginatedResponse(data, parseInt(count), page, limit);
    }

    if (userId) {
      const [data, [{ count }]] = await Promise.all([
        query<EventRow>(
          `SELECT e.* FROM events e
           JOIN organization_members om ON om.organization_id = e.organization_id
           WHERE om.user_id = $1 AND om.status = 'active'
           ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) as count FROM events e
           JOIN organization_members om ON om.organization_id = e.organization_id
           WHERE om.user_id = $1 AND om.status = 'active'`,
          [userId]
        ),
      ]);
      return buildPaginatedResponse(data, parseInt(count), page, limit);
    }

    return buildPaginatedResponse([], 0, page, limit);
  }

  async update(eventId: string, data: Partial<{
    title: string; description: string; event_mode: string; visibility: string;
    max_participants: number; start_time: string; end_time: string; status: string;
  }>) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined && ALLOWED_EVENT_UPDATE_FIELDS.has(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (fields.length === 0) throw new AppError('No valid fields to update', 400, 'VALIDATION_FAILED');

    fields.push('updated_at = NOW()');
    values.push(eventId);

    const [event] = await query<EventRow>(
      `UPDATE events SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
    return event;
  }

  async delete(eventId: string) {
    const result = await transaction(async (client) => {
      // Manually delete rows that reference participants (missing ON DELETE CASCADE in some deployments)
      await client.query(
        `DELETE FROM post_reactions WHERE post_id IN (SELECT id FROM activity_posts WHERE event_id = $1)`, [eventId]
      );
      await client.query(`DELETE FROM activity_posts WHERE event_id = $1`, [eventId]);
      await client.query(
        `DELETE FROM game_actions WHERE participant_id IN (SELECT id FROM participants WHERE event_id = $1)`, [eventId]
      );
      await client.query(
        `DELETE FROM game_results WHERE participant_id IN (SELECT id FROM participants WHERE event_id = $1)`, [eventId]
      );
      await client.query(
        `DELETE FROM leaderboard_entries WHERE participant_id IN (SELECT id FROM participants WHERE event_id = $1)`, [eventId]
      );
      await client.query(
        `DELETE FROM event_messages WHERE event_id = $1`, [eventId]
      );
      // Now safe to delete the event (cascades to participants, game_sessions, etc.)
      const { rows } = await client.query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);
      return rows;
    });
    if (result.length === 0) throw new AppError('Event not found', 404, 'NOT_FOUND');
    return { message: 'Event deleted' };
  }

  async inviteParticipant(eventId: string, invitedByMemberId: string, email: string, lang?: string) {
    const event = await this.getById(eventId);

    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );
    if (parseInt(count) >= event.max_participants) {
      throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
    }

    const token = crypto.randomBytes(32).toString('hex');

    await query(
      `INSERT INTO event_invitations (id, event_id, email, invited_by_member_id, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [uuid(), eventId, email, invitedByMemberId, token]
    );

    await sendEmail({
      to: email,
      type: 'event_invitation',
      data: { eventTitle: event.title, link: `${env.frontendUrl}/join/${eventId}?token=${token}` },
      lang,
    });

    return { message: 'Invitation sent' };
  }

  async join(eventId: string, memberId: string) {
    const existing = await queryOne(
      'SELECT id FROM participants WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL',
      [eventId, memberId]
    );
    if (existing) throw new AppError('You are already a participant in this event', 409, 'ALREADY_PARTICIPANT');

    const participantId = uuid();
    await transaction(async (client) => {
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      const event = await this.getById(eventId);
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      await client.query(
        `INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
         VALUES ($1, $2, $3, 'member', NOW(), NOW())`,
        [participantId, eventId, memberId]
      );
    });

    return { participant_id: participantId };
  }

  async leave(eventId: string, memberId: string) {
    const result = await query(
      `UPDATE participants SET left_at = NOW() WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL RETURNING id`,
      [eventId, memberId]
    );
    if (result.length === 0) throw new AppError('You are not a participant in this event', 404, 'NOT_PARTICIPANT');
    return { message: 'Left event' };
  }

  async sendMessage(eventId: string, participantId: string, message: string, messageType: string = 'text') {
    const participant = await queryOne(
      'SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND left_at IS NULL',
      [participantId, eventId]
    );
    if (!participant) throw new AppError('Invalid participant for this event', 403, 'NOT_PARTICIPANT');

    const sanitizedMessage = sanitizeText(message, 2000);
    if (sanitizedMessage.length === 0) throw new AppError('Message cannot be empty', 400, 'VALIDATION_FAILED');

    const [msg] = await query(
      `INSERT INTO event_messages (id, event_id, participant_id, message, message_type, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [uuid(), eventId, participantId, sanitizedMessage, messageType]
    );
    return msg;
  }

  async getMessages(eventId: string, pagination: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination);
    const [data, [{ count }]] = await Promise.all([
      query(
        `SELECT em.*, p.guest_name, u.name as user_name
         FROM event_messages em
         LEFT JOIN participants p ON p.id = em.participant_id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE em.event_id = $1 ORDER BY em.created_at ASC LIMIT $2 OFFSET $3`,
        [eventId, limit, offset]
      ),
      query<{ count: string }>('SELECT COUNT(*) as count FROM event_messages WHERE event_id = $1', [eventId]),
    ]);
    return buildPaginatedResponse(data, parseInt(count), page, limit);
  }

  async createPost(eventId: string, participantId: string, content: string) {
    const participant = await queryOne(
      'SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND left_at IS NULL',
      [participantId, eventId]
    );
    if (!participant) throw new AppError('Invalid participant for this event', 403, 'NOT_PARTICIPANT');

    const sanitizedContent = sanitizeText(content, 5000);
    if (sanitizedContent.length === 0) throw new AppError('Post content cannot be empty', 400, 'VALIDATION_FAILED');

    const [post] = await query(
      `INSERT INTO activity_posts (id, event_id, author_participant_id, content, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [uuid(), eventId, participantId, sanitizedContent]
    );
    return post;
  }

  async reactToPost(postId: string, participantId: string, reactionType: string) {
    const [reaction] = await query(
      `INSERT INTO post_reactions (id, post_id, participant_id, reaction_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING RETURNING *`,
      [uuid(), postId, participantId, reactionType]
    );
    return reaction || { message: 'Reaction already exists' };
  }
}
