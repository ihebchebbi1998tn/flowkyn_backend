import { query, queryOne } from '../../config/database';
import type { AiInstanceState } from '../types/runtime.types';

export class PersonalizationService {
  async buildParticipantPersona(
    eventId: string | null | undefined,
    participantId: string
  ): Promise<Record<string, unknown>> {
    if (!eventId) return { participantId };
    const profile = await queryOne<{
      display_name: string | null;
      role: string | null;
      language: string | null;
    }>(
      `SELECT ep.display_name, ep.role, ep.language
       FROM event_profiles ep
       WHERE ep.event_id = $1 AND ep.participant_id = $2`,
      [eventId, participantId]
    );
    return {
      participantId,
      displayName: profile?.display_name || null,
      role: profile?.role || null,
      language: profile?.language || 'en',
    };
  }

  async persistPrivateProjection(args: {
    instanceId: string;
    participantId: string;
    revision: number;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO ai_event_private_participant_views
       (id, instance_id, participant_id, revision, payload_json)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4)
       ON CONFLICT (instance_id, participant_id, revision)
       DO UPDATE SET payload_json = EXCLUDED.payload_json`,
      [args.instanceId, args.participantId, args.revision, args.payload]
    );
  }

  async projectAndPersistAll(
    instanceState: AiInstanceState,
    participants: string[],
    revision: number
  ): Promise<void> {
    const currentActivity = instanceState.templateDsl.activities[instanceState.currentActivityIndex];
    const state = instanceState.activityStates[currentActivity.id] || {};
    await Promise.all(
      participants.map(async (participantId) => {
        const payload = {
          activityId: currentActivity.id,
          activityType: currentActivity.type,
          state,
          participantId,
        };
        await this.persistPrivateProjection({
          instanceId: instanceState.templateId,
          participantId,
          revision,
          payload,
        });
      })
    );
  }
}
