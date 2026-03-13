/**
 * @fileoverview Event Messages & Posts Service
 *
 * Handles real-time messaging and activity posts within events:
 * - Event chat messages (text, system messages)
 * - Activity posts (longer-form content)
 * - Post reactions (emoji reactions)
 *
 * All message content is sanitized server-side via sanitizeText().
 * Participant identity is verified before allowing any writes.
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { sanitizeText } from '../utils/sanitize';

export class EventMessagesService {
  /**
   * Send a chat message in an event.
   *
   * @param eventId - The event to send the message in
   * @param participantId - The participant sending the message (verified server-side)
   * @param message - Raw message text (will be sanitized, max 2000 chars)
   * @param messageType - Message type: 'text' (default), 'system', etc.
   * @throws {AppError} 403 if participant doesn't belong to this event
   * @throws {AppError} 400 if message is empty after sanitization
   */
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

  /**
   * Retrieve paginated chat messages for an event.
   * Messages are ordered chronologically (ASC) and include sender info.
   *
   * @param eventId - The event to fetch messages for
   * @param pagination - Page and limit parameters
   * @returns Paginated response with messages and sender details
   */
  async getMessages(eventId: string, pagination: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination);
    const [data, [{ count }]] = await Promise.all([
      query(
        `SELECT em.*, p.guest_name, p.participant_type, p.guest_avatar,
                u.name as user_name, u.id as user_id,
                COALESCE(u.avatar_url, p.guest_avatar) as avatar_url
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

  /**
   * Retrieve paginated activity posts for an event, including basic reaction aggregates.
   *
   * This powers async, wall-style games like "Wins of the Week" where posts
   * should be shared across all participants instead of kept in local UI state.
   */
  async getPosts(eventId: string, pagination: { page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(pagination);

    // Fetch posts with author display info
    const [posts, [{ count }]] = await Promise.all([
      query(
        `SELECT ap.*,
                COALESCE(u.name, p.guest_name, 'Unknown') AS author_name,
                COALESCE(u.avatar_url, p.guest_avatar) AS author_avatar
         FROM activity_posts ap
         JOIN participants p ON p.id = ap.author_participant_id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE ap.event_id = $1
         ORDER BY ap.created_at DESC
         LIMIT $2 OFFSET $3`,
        [eventId, limit, offset]
      ),
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM activity_posts WHERE event_id = $1',
        [eventId]
      ),
    ]);

    if (posts.length === 0) {
      return buildPaginatedResponse([], 0, page, limit);
    }

    // Aggregate reactions per post/type
    const postIds = posts.map((p: any) => p.id);
    const reactions = await query<{
      post_id: string;
      reaction_type: string;
      count: string;
    }>(
      `SELECT post_id, reaction_type, COUNT(*)::text AS count
       FROM post_reactions
       WHERE post_id = ANY($1::uuid[])
       GROUP BY post_id, reaction_type`,
      [postIds]
    );

    const reactionsByPost = new Map<string, { type: string; count: number }[]>();
    for (const r of reactions) {
      if (!reactionsByPost.has(r.post_id)) reactionsByPost.set(r.post_id, []);
      reactionsByPost.get(r.post_id)!.push({
        type: r.reaction_type,
        count: parseInt(r.count, 10),
      });
    }

    const dataWithReactions = posts.map((p: any) => ({
      id: p.id,
      event_id: p.event_id,
      author_participant_id: p.author_participant_id,
      content: p.content,
      created_at: p.created_at,
      author_name: p.author_name,
      author_avatar: p.author_avatar,
      reactions: reactionsByPost.get(p.id) || [],
    }));

    return buildPaginatedResponse(
      dataWithReactions,
      parseInt(count, 10),
      page,
      limit
    );
  }

  /**
   * Create an activity post in an event.
   * Posts are longer-form content (up to 5000 chars) displayed in the activity feed.
   *
   * @param eventId - The event to create the post in
   * @param participantId - The author's participant ID
   * @param content - Raw post content (sanitized to 5000 chars max)
   * @throws {AppError} 403 if participant doesn't belong to this event
   */
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

  /**
   * React to an activity post.
   * Uses ON CONFLICT to prevent duplicate reactions from the same participant.
   *
   * @param postId - The post to react to
   * @param participantId - The reactor's participant ID
   * @param reactionType - Reaction emoji/type string
   */
  async reactToPost(postId: string, participantId: string, reactionType: string) {
    const [reaction] = await query(
      `INSERT INTO post_reactions (id, post_id, participant_id, reaction_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (post_id, participant_id, reaction_type) DO NOTHING RETURNING *`,
      [uuid(), postId, participantId, reactionType]
    );
    return reaction || { message: 'Reaction already exists' };
  }
}
