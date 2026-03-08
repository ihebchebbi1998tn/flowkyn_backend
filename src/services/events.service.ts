import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { EventRow, ParticipantRow } from '../types';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
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
    if (!event) throw new AppError('Event not found', 404);
    return event;
  }

  async list(pagination: { page?: number; limit?: number }, orgId?: string) {
    const { page, limit, offset } = parsePagination(pagination);
    const whereClause = orgId ? 'WHERE organization_id = $1' : '';
    const params = orgId ? [orgId, limit, offset] : [limit, offset];
    const countParams = orgId ? [orgId] : [];
    const limitIdx = orgId ? '$2' : '$1';
    const offsetIdx = orgId ? '$3' : '$2';

    const [data, [{ count }]] = await Promise.all([
      query<EventRow>(`SELECT * FROM events ${whereClause} ORDER BY created_at DESC LIMIT ${limitIdx} OFFSET ${offsetIdx}`, params),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM events ${whereClause}`, countParams),
    ]);
    return buildPaginatedResponse(data, parseInt(count), page, limit);
  }

  /**
   * Update an event — caller must verify ownership before calling.
   */
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
    if (fields.length === 0) throw new AppError('No valid fields to update', 400);

    fields.push('updated_at = NOW()');
    values.push(eventId);

    const [event] = await query<EventRow>(
      `UPDATE events SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!event) throw new AppError('Event not found', 404);
    return event;
  }

  async delete(eventId: string) {
    const result = await query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);
    if (result.length === 0) throw new AppError('Event not found', 404);
    return { message: 'Event deleted' };
  }

  async inviteParticipant(eventId: string, invitedByMemberId: string, email: string) {
    const event = await this.getById(eventId);

    // Check max participants
    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );
    if (parseInt(count) >= event.max_participants) {
      throw new AppError('Event has reached maximum participants', 400);
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
      data: { eventTitle: event.title, link: `https://app.flowkyn.com/events/${eventId}/join?token=${token}` },
    });

    return { message: 'Invitation sent' };
  }

  async join(eventId: string, memberId: string) {
    // Check if already a participant (prevent duplicates)
    const existing = await queryOne(
      'SELECT id FROM participants WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL',
      [eventId, memberId]
    );
    if (existing) throw new AppError('Already a participant in this event', 409);

    // Check max participants
    const event = await this.getById(eventId);
    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );
    if (parseInt(count) >= event.max_participants) {
      throw new AppError('Event has reached maximum participants', 400);
    }

    const participantId = uuid();
    await query(
      `INSERT INTO participants (id, event_id, organization_member_id, participant_type, joined_at, created_at)
       VALUES ($1, $2, $3, 'member', NOW(), NOW())`,
      [participantId, eventId, memberId]
    );
    return { participant_id: participantId };
  }

  async leave(eventId: string, memberId: string) {
    const result = await query(
      `UPDATE participants SET left_at = NOW() WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL RETURNING id`,
      [eventId, memberId]
    );
    if (result.length === 0) throw new AppError('Not a participant in this event', 404);
    return { message: 'Left event' };
  }

  async sendMessage(eventId: string, participantId: string, message: string, messageType: string = 'text') {
    // Verify participant belongs to this event
    const participant = await queryOne(
      'SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND left_at IS NULL',
      [participantId, eventId]
    );
    if (!participant) throw new AppError('Invalid participant for this event', 403);

    const [msg] = await query(
      `INSERT INTO event_messages (id, event_id, participant_id, message, message_type, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [uuid(), eventId, participantId, message, messageType]
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
    // Verify participant belongs to this event
    const participant = await queryOne(
      'SELECT id FROM participants WHERE id = $1 AND event_id = $2 AND left_at IS NULL',
      [participantId, eventId]
    );
    if (!participant) throw new AppError('Invalid participant for this event', 403);

    const [post] = await query(
      `INSERT INTO activity_posts (id, event_id, author_participant_id, content, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [uuid(), eventId, participantId, content]
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
    return reaction;
  }
}
