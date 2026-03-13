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
      [eventId, participantId, displayName, avatarUrl || null],
    );
    return row;
  }
}

