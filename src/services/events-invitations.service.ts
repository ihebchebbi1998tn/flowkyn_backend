/**
 * @fileoverview Event Invitations Service
 *
 * Handles all invitation-related operations for events:
 * - Token generation & validation
 * - Invitation acceptance (authenticated users)
 * - Guest join flow (no auth required)
 *
 * Separated from the core EventsService for maintainability.
 * Invitation tokens are 32-byte hex strings with a 7-day TTL.
 * Tokens are stored as SHA-256 hashes for defense-in-depth security.
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { hasGuestIdentityKey } from '../utils/dbSafeColumns';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { sanitizeText } from '../utils/sanitize';
import { env } from '../config/env';
import crypto from 'crypto';

/** Hash a token using SHA-256 (consistent with refresh/password-reset token hashing) */
function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class EventInvitationsService {
  /**
   * Validate an invitation token and return event + invitation info.
   * Used by the lobby page to display event details before joining.
   *
   * @param eventId - The event the invitation belongs to
   * @param token - The hex invitation token from the email link
   * @throws {AppError} 404 if token is invalid, 400 if expired/used/revoked
   */
  async validateInvitationToken(eventId: string, token: string) {
    const hashedToken = hashInvitationToken(token);
    const invitation = await queryOne<any>(
      `SELECT ei.id, ei.email, ei.status, ei.expires_at, ei.created_at,
              e.title as event_title, e.description as event_description,
              e.event_mode, e.status as event_status,
              o.name as organization_name
       FROM event_invitations ei
       JOIN events e ON e.id = ei.event_id
       JOIN organizations o ON o.id = e.organization_id
       WHERE ei.event_id = $1 AND ei.token = $2`,
      [eventId, hashedToken]
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
   * Accept an event invitation for a logged-in user.
   *
   * Flow:
   * 1. Validates the invitation token
   * 2. Auto-creates org membership if the user isn't already a member
   * 3. Creates a participant record
   * 4. Marks the invitation as accepted
   *
   * @param eventId - Target event ID
   * @param token - Invitation token
   * @param userId - Authenticated user's ID
   * @returns Object with participant_id and already_joined flag
   */
  async acceptInvitation(eventId: string, token: string, userId: string, event: any) {
    await this.validateInvitationToken(eventId, token);

    return await transaction(async (client) => {
      // Check participant limit (use client for transaction consistency)
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      // Find or create org membership (use client to stay within transaction)
      const memberRows = await client.query<{ id: string }>(
        `SELECT om.id FROM organization_members om WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
        [event.organization_id, userId]
      );
      let member = memberRows.rows[0] || null;

      if (!member) {
        // Lookup the default 'member' role inside the transaction for atomicity
        const memberRole = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE name = 'member' LIMIT 1`
        );
        const roleRow = memberRole.rows[0];
        if (!roleRow) throw new AppError('Default member role not found', 500, 'INTERNAL_ERROR');

        const memberId = uuid();
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role_id, status, joined_at, created_at)
           VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())`,
          [memberId, event.organization_id, userId, roleRow.id]
        );
        member = { id: memberId };
      }

      // Check if already participating (use client for transaction consistency)
      const existingRows = await client.query<{ id: string }>(
        'SELECT id FROM participants WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL',
        [eventId, member.id]
      );
      const existing = existingRows.rows[0] || null;
      if (existing) {
        await client.query(
          `UPDATE event_invitations SET status = 'accepted' WHERE event_id = $1 AND token = $2`,
          [eventId, hashInvitationToken(token)]
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
        [eventId, hashInvitationToken(token)]
      );

      return { participant_id: participantId, already_joined: false };
    });
  }

  /**
   * Join an event as a guest (no authentication required).
   *
   * Validates:
   * - Guest access is enabled for the event
   * - Token is valid (if provided) or event is public
   * - Participant limit hasn't been reached
   *
   * @param eventId - Target event ID
   * @param data - Guest info (name, optional email/avatar/token)
   * @param event - Pre-fetched event record with settings
   * @returns Object with participant_id and sanitized guest_name
   */
  async joinAsGuest(
    eventId: string,
    data: { name: string; email?: string; avatar_url?: string; token?: string; guest_identity_key?: string },
    event: any,
  ) {
    // null means no event_settings row (shouldn't happen, but default to allowing guests)
    if ((event as any).allow_guests === false) {
      throw new AppError('This event does not allow guest participants', 403, 'FORBIDDEN');
    }

    if (data.token) {
      await this.validateInvitationToken(eventId, data.token);
    }
    // Note: visibility check removed — all events allow guest joins when allow_guests is true.
    // Authentication is only required for admin actions (creating games, managing events).

    const sanitizedName = sanitizeText(data.name, 100).trim();
    if (sanitizedName.length === 0) throw new AppError('Name is required', 400, 'VALIDATION_FAILED');

    const identityKey = typeof data.guest_identity_key === 'string' ? data.guest_identity_key.trim() : '';
    const normalizedIdentityKey = identityKey || null;

    const hasIdentityCol = await hasGuestIdentityKey();

    return await transaction(async (client) => {
      if (normalizedIdentityKey && hasIdentityCol) {
        const existingByIdentity = await client.query<{ id: string; guest_name: string | null }>(
          `SELECT id, guest_name
           FROM participants
           WHERE event_id = $1
             AND participant_type = 'guest'
             AND guest_identity_key = $2
             AND left_at IS NULL
           ORDER BY joined_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
           LIMIT 1`,
          [eventId, normalizedIdentityKey],
        );

        if (existingByIdentity.rows.length > 0) {
          const row = existingByIdentity.rows[0];
          const resolvedName = sanitizedName || row.guest_name || 'Guest';
          await client.query(
            `UPDATE participants
             SET guest_name = $1,
                 guest_avatar = $2
             WHERE id = $3`,
            [resolvedName, data.avatar_url || null, row.id],
          );
          return { participant_id: row.id, guest_name: resolvedName, already_joined: true };
        }
      }

      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      const participantId = uuid();

      // Exclude any existing participant with the same guest_identity_key (self on refresh)
      const selfExcludeId = normalizedIdentityKey && hasIdentityCol
        ? (await client.query<{ id: string }>(
            `SELECT id FROM participants WHERE event_id = $1 AND guest_identity_key = $2 AND left_at IS NULL LIMIT 1`,
            [eventId, normalizedIdentityKey]
          )).rows[0]?.id
        : null;

      const conflict = await client.query(
        `SELECT id FROM (
          SELECT id FROM participants WHERE event_id = $1 AND LOWER(guest_name) = LOWER($2) AND left_at IS NULL AND ($3::uuid IS NULL OR id != $3)
          UNION ALL
          SELECT ep.participant_id as id
          FROM event_profiles ep
          JOIN participants p ON p.id = ep.participant_id
          WHERE ep.event_id = $1 AND LOWER(ep.display_name) = LOWER($2) AND p.left_at IS NULL AND ($3::uuid IS NULL OR ep.participant_id != $3)
        ) combined LIMIT 1`,
        [eventId, sanitizedName, selfExcludeId]
      );

      if (conflict.rows.length > 0) {
        throw new AppError('This name is already taken in this lobby. Please choose a slightly different one.', 400, 'NAME_TAKEN');
      }

      if (hasIdentityCol) {
        await client.query(
          `INSERT INTO participants (id, event_id, guest_name, guest_avatar, guest_identity_key, participant_type, joined_at, created_at)
           VALUES ($1, $2, $3, $4, $5, 'guest', NOW(), NOW())`,
          [participantId, eventId, sanitizedName, data.avatar_url || null, normalizedIdentityKey]
        );
      } else {
        await client.query(
          `INSERT INTO participants (id, event_id, guest_name, guest_avatar, participant_type, joined_at, created_at)
           VALUES ($1, $2, $3, $4, 'guest', NOW(), NOW())`,
          [participantId, eventId, sanitizedName, data.avatar_url || null]
        );
      }

      if (data.token) {
        await client.query(
          `UPDATE event_invitations SET status = 'accepted' WHERE event_id = $1 AND token = $2`,
          [eventId, hashInvitationToken(data.token)]
        );
      }

      return { participant_id: participantId, guest_name: sanitizedName, already_joined: false };
    });
  }

  /**
   * Send an event invitation email.
   *
   * Creates a pending invitation record and sends an email with a join link.
   * The link format is: `{frontendUrl}/join/{eventId}?token={token}`
   *
   * @param eventId - Target event ID
   * @param invitedByMemberId - The org member ID who is sending the invite
   * @param email - Recipient email address
   * @param eventTitle - Event title for the email template
   * @param maxParticipants - Event's max participant limit
   * @param lang - Email language (defaults to 'en')
   */
  async inviteParticipant(eventId: string, invitedByMemberId: string, email: string, eventTitle: string, maxParticipants: number, lang?: string, gameId?: string, startTime?: string, endTime?: string) {
    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );
    if (parseInt(count) >= maxParticipants) {
      throw new AppError(`Event has reached its maximum of ${maxParticipants} participants`, 400, 'EVENT_FULL');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashInvitationToken(rawToken);

    await query(
      `INSERT INTO event_invitations (id, event_id, email, invited_by_member_id, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [uuid(), eventId, email, invitedByMemberId, hashedToken]
    );

    // Use the provided gameId (config ID like '1','2') for the ?activity= param in the join link
    const activityParam = gameId && String(gameId).trim() ? String(gameId).trim() : '';
    await sendEmail({
      to: email,
      type: 'event_invitation',
      data: { 
        eventTitle, 
        link: `${env.frontendUrl}/join/${eventId}?token=${rawToken}${activityParam ? `&activity=${activityParam}` : ''}`,
        startTime: startTime ? String(startTime) : undefined,
        endTime: endTime ? String(endTime) : undefined
      },
      lang,
    });

    return { message: 'Invitation sent' };
  }
}
