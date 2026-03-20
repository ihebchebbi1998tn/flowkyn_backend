import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export class EventProfilesService {
  async getForParticipant(eventId: string, participantId: string) {
    const row = await queryOne<{
      id: string;
      display_name: string;
      avatar_url: string | null;
    }>(
      `SELECT id, display_name, avatar_url
       FROM event_profiles
       WHERE event_id = $1 AND participant_id = $2`,
      [eventId, participantId],
    );
    if (!row) {
      throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
    }
    return row;
  }

  async upsertForParticipant(
    eventId: string,
    participantId: string,
    displayName: string,
    avatarUrl?: string | null,
  ) {
    const sanitizedName = displayName.trim();
    
    // Check for display name conflicts within the same event
    // Exclude the current participant's own name (whether they have a profile or guest_name)
    const conflict = await queryOne(
      `SELECT id FROM (
        -- Check event_profiles, excluding current participant
        SELECT ep.participant_id as id
        FROM event_profiles ep
        JOIN participants p ON p.id = ep.participant_id
        WHERE ep.event_id = $1
          AND LOWER(ep.display_name) = LOWER($2)
          AND ep.participant_id != $3
          AND p.left_at IS NULL
        UNION ALL
        -- Check guest_names, excluding current participant
        SELECT id
        FROM participants p
        WHERE p.event_id = $1
          AND LOWER(p.guest_name) = LOWER($2)
          AND p.id != $3
          AND p.left_at IS NULL
      ) combined LIMIT 1`,
      [eventId, sanitizedName, participantId]
    );

    if (conflict) {
      throw new AppError('This nickname is already taken in this event. Please choose another one.', 400, 'NAME_TAKEN');
    }

    const [row] = await query<{
      id: string;
      display_name: string;
      avatar_url: string | null;
    }>(
      `INSERT INTO event_profiles (event_id, participant_id, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, participant_id)
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     avatar_url   = EXCLUDED.avatar_url,
                     updated_at   = NOW()
       RETURNING id, display_name, avatar_url`,
      [eventId, participantId, sanitizedName, avatarUrl || null],
    );
    // Keep participants.guest_name in sync for guests so token re-sign uses correct name
    await query(
      `UPDATE participants
       SET guest_name = $1
       WHERE id = $2 AND participant_type = 'guest' AND event_id = $3`,
      [sanitizedName, participantId, eventId],
    );
    return row;
  }
}

