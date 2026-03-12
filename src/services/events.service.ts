/**
 * @fileoverview Core Events Service
 *
 * Handles the event lifecycle: CRUD operations, participant management,
 * and public info queries. Delegates invitation logic to EventInvitationsService
 * and messaging to EventMessagesService for maintainability.
 *
 * Architecture:
 * - events.service.ts ............. CRUD, participants, public info (this file)
 * - events-invitations.service.ts . Token validation, invitation acceptance, guest join
 * - events-messages.service.ts .... Chat messages, activity posts, reactions
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { EventRow } from '../types';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';

// Re-export sub-services for convenience
export { EventInvitationsService } from './events-invitations.service';
export { EventMessagesService } from './events-messages.service';

/** Whitelist of allowed update fields to prevent SQL injection */
const ALLOWED_EVENT_UPDATE_FIELDS = new Set([
  'title', 'description', 'event_mode', 'visibility',
  'max_participants', 'start_time', 'end_time', 'status',
]);

export class EventsService {
  /**
   * Create a new event within an organization.
   * Automatically creates default event_settings and sets status to 'draft'.
   *
   * @param memberId - The creating member's organization_member ID
   * @param data - Event creation payload
   * @returns The newly created event row
   */
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

  /**
   * Fetch a single event by ID, including its settings.
   * @throws {AppError} 404 if event doesn't exist
   */
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
   * Public event info — no authentication required.
   * Returns only safe fields for the lobby page display.
   * Used by guests and invited users before joining.
   */
  async getPublicInfo(eventId: string) {
    const event = await queryOne<any>(
      `SELECT e.id, e.title, e.description, e.event_mode, e.visibility,
              e.max_participants, e.start_time, e.end_time, e.status,
              e.created_at, es.allow_guests,
              o.name as organization_name, o.logo_url as organization_logo,
              om_creator.user_id as created_by_user_id
       FROM events e
       LEFT JOIN event_settings es ON es.event_id = e.id
       LEFT JOIN organizations o ON o.id = e.organization_id
       LEFT JOIN organization_members om_creator ON om_creator.id = e.created_by_member_id
       WHERE e.id = $1`,
      [eventId]
    );
    if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

    const [{ count: participantCount }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );

    const [{ count: invitedCount }] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM event_invitations WHERE event_id = $1`,
      [eventId]
    );

    return { ...event, participant_count: parseInt(participantCount), invited_count: parseInt(invitedCount) };
  }

  /**
   * List participants for an event lobby.
   * Maps internal DB fields to a clean public response shape.
   * No auth required — used by the lobby page.
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

  /**
   * List events visible to a user, optionally filtered by organization.
   * If orgId is provided, returns events for that org.
   * Otherwise, returns events from all orgs the user belongs to.
   */
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

  /**
   * Update event fields. Only whitelisted fields are accepted.
   * @throws {AppError} 400 if no valid fields provided, 404 if event not found
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

  /**
   * Delete an event and all related data.
   * Manually cascades through dependent tables that may lack ON DELETE CASCADE.
   */
  async delete(eventId: string) {
    const result = await transaction(async (client) => {
      // 1. Delete post reactions → activity posts
      await client.query(`DELETE FROM post_reactions WHERE post_id IN (SELECT id FROM activity_posts WHERE event_id = $1)`, [eventId]);
      await client.query(`DELETE FROM activity_posts WHERE event_id = $1`, [eventId]);

      // 2. Delete game data: actions → results → state snapshots → rounds → sessions
      await client.query(`DELETE FROM game_actions WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = $1)`, [eventId]);
      await client.query(`DELETE FROM game_results WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = $1)`, [eventId]);
      await client.query(`DELETE FROM game_state_snapshots WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = $1)`, [eventId]);
      await client.query(`DELETE FROM game_rounds WHERE game_session_id IN (SELECT id FROM game_sessions WHERE event_id = $1)`, [eventId]);
      await client.query(`DELETE FROM game_sessions WHERE event_id = $1`, [eventId]);

      // 3. Delete leaderboard entries (via participants)
      await client.query(`DELETE FROM leaderboard_entries WHERE participant_id IN (SELECT id FROM participants WHERE event_id = $1)`, [eventId]);

      // 4. Delete messages & invitations
      await client.query(`DELETE FROM event_messages WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM event_invitations WHERE event_id = $1`, [eventId]);

      // 5. Delete participants
      await client.query(`DELETE FROM participants WHERE event_id = $1`, [eventId]);

      // 6. Delete event settings
      await client.query(`DELETE FROM event_settings WHERE event_id = $1`, [eventId]);

      // 7. Delete the event itself
      const { rows } = await client.query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);
      return rows;
    });
    if (result.length === 0) throw new AppError('Event not found', 404, 'NOT_FOUND');
    return { message: 'Event deleted' };
  }

  /**
   * Join an event as an authenticated org member.
   * @throws {AppError} 409 if already participating, 400 if event is full
   */
  async join(eventId: string, memberId: string) {
    const event = await this.getById(eventId);
    if (event.status === 'completed' || event.status === 'cancelled') {
      throw new AppError(`Cannot join — event is ${event.status}`, 400, 'VALIDATION_FAILED');
    }

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

  /**
   * Leave an event (soft-delete by setting left_at).
   * @throws {AppError} 404 if not currently participating
   */
  async leave(eventId: string, memberId: string) {
    const result = await query(
      `UPDATE participants SET left_at = NOW() WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL RETURNING id`,
      [eventId, memberId]
    );
    if (result.length === 0) throw new AppError('You are not a participant in this event', 404, 'NOT_PARTICIPANT');
    return { message: 'Left event' };
  }
}
