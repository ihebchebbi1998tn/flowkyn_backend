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
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { sendEmail } from './email.service';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';
import { sanitizeText } from '../utils/sanitize';
import { env } from '../config/env';
import crypto from 'crypto';

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
      // Check participant limit
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
        [eventId]
      );
      if (parseInt(count) >= event.max_participants) {
        throw new AppError(`Event has reached its maximum of ${event.max_participants} participants`, 400, 'EVENT_FULL');
      }

      // Find or create org membership
      let member = await queryOne<{ id: string }>(
        `SELECT om.id FROM organization_members om WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'`,
        [event.organization_id, userId]
      );

      if (!member) {
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

      // Check if already participating
      const existing = await queryOne(
        'SELECT id FROM participants WHERE event_id = $1 AND organization_member_id = $2 AND left_at IS NULL',
        [eventId, member.id]
      );
      if (existing) {
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
  async joinAsGuest(eventId: string, data: { name: string; email?: string; avatar_url?: string; token?: string }, event: any) {
    if (!(event as any).allow_guests) {
      throw new AppError('This event does not allow guest participants', 403, 'FORBIDDEN');
    }

    if (data.token) {
      await this.validateInvitationToken(eventId, data.token);
    } else if (event.visibility === 'private') {
      throw new AppError('A valid invitation token is required to join this private event', 403, 'FORBIDDEN');
    }

    return await transaction(async (client) => {
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
  async inviteParticipant(eventId: string, invitedByMemberId: string, email: string, eventTitle: string, maxParticipants: number, lang?: string) {
    const [{ count }] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = $1 AND left_at IS NULL',
      [eventId]
    );
    if (parseInt(count) >= maxParticipants) {
      throw new AppError(`Event has reached its maximum of ${maxParticipants} participants`, 400, 'EVENT_FULL');
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
      data: { eventTitle, link: `${env.frontendUrl}/join/${eventId}?token=${token}` },
      lang,
    });

    return { message: 'Invitation sent' };
  }
}
