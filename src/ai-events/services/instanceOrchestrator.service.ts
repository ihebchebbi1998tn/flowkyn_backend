import { query, queryOne, transaction } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getActivityPlugin } from '../runtime/activityRegistry';
import type { AiInstanceState } from '../types/runtime.types';
import type { AiEventTemplateDsl } from '../types/template.types';
import { PersonalizationService } from './personalization.service';

export class InstanceOrchestratorService {
  private readonly personalization = new PersonalizationService();

  async startInstance(args: {
    templateId: string;
    templateVersionId: string;
    eventId?: string | null;
    participantIds: string[];
    startedByParticipantId: string;
    runtimeConfig?: Record<string, unknown>;
  }) {
    const template = await queryOne<{ dsl_json: AiEventTemplateDsl }>(
      `SELECT dsl_json FROM ai_event_template_versions WHERE id = $1`,
      [args.templateVersionId]
    );
    if (!template) throw new AppError('Template version not found', 404, 'NOT_FOUND');
    const dsl = template.dsl_json;
    const firstActivity = dsl.activities[0];
    const plugin = getActivityPlugin(firstActivity.type);
    if (!plugin) throw new AppError('No runtime for first activity type', 400, 'VALIDATION_FAILED');
    plugin.validateConfig(firstActivity.config);

    const instanceId = crypto.randomUUID();
    const initialActivityState = plugin.initState(firstActivity, {
      instanceId,
      eventId: args.eventId || null,
      actorParticipantId: null,
      nowIso: new Date().toISOString(),
    });

    const state: AiInstanceState = {
      hostParticipantId: args.startedByParticipantId,
      presenterParticipantId: args.startedByParticipantId,
      templateId: args.templateId,
      templateVersionId: args.templateVersionId,
      currentActivityIndex: 0,
      templateDsl: dsl,
      activityStates: { [firstActivity.id]: initialActivityState },
      status: 'in_progress',
    };

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO ai_event_instances
         (id, template_id, template_version_id, event_id, status, current_activity_index, instance_config_json, started_at, started_by_participant_id)
         VALUES ($1, $2, $3, $4, 'in_progress', 0, $5, NOW(), $6)`,
        [
          instanceId,
          args.templateId,
          args.templateVersionId,
          args.eventId || null,
          args.runtimeConfig || {},
          args.startedByParticipantId,
        ]
      );
      for (const participantId of args.participantIds) {
        await client.query(
          `INSERT INTO ai_event_instance_participants (id, instance_id, participant_id)
           VALUES (uuid_generate_v4(), $1, $2)
           ON CONFLICT (instance_id, participant_id) DO NOTHING`,
          [instanceId, participantId]
        );
      }
      await client.query(
        `INSERT INTO ai_event_instance_snapshots (id, instance_id, revision, state_json)
         VALUES (uuid_generate_v4(), $1, 1, $2)`,
        [instanceId, this.toPublicSnapshot(state)]
      );
    });

    await this.persistPrivateViews(instanceId, 1, state);
    return { instanceId, revision: 1, state: this.toPublicSnapshot(state) };
  }

  async applyAction(args: {
    instanceId: string;
    actionType: string;
    payload?: Record<string, unknown>;
    participantId?: string | null;
  }) {
    const latest = await queryOne<{ revision: number; state_json: AiInstanceState }>(
      `SELECT revision, state_json
       FROM ai_event_instance_snapshots
       WHERE instance_id = $1
       ORDER BY revision DESC
       LIMIT 1`,
      [args.instanceId]
    );
    if (!latest) throw new AppError('Instance snapshot not found', 404, 'NOT_FOUND');

    const state = latest.state_json as unknown as AiInstanceState;

    // Permission enforcement (MVP):
    // - If the action is a reveal action, require the DSL `permissions.canReveal`.
    // - `host` and `presenter` both map to the instance `startedByParticipantId` for now.
    if (args.actionType === 'icebreaker:reveal' || args.actionType.endsWith(':reveal')) {
      const actor = args.participantId;
      const canReveal = state.templateDsl.permissions.canReveal;
      const isAllowed =
        canReveal === 'all' ||
        (canReveal === 'host' && !!actor && actor === state.hostParticipantId) ||
        (canReveal === 'presenter' && !!actor && actor === state.presenterParticipantId);

      if (!isAllowed) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }
    }

    const currentActivity = state.templateDsl.activities[state.currentActivityIndex];
    const plugin = getActivityPlugin(currentActivity.type);
    if (!plugin) throw new AppError('No runtime for current activity', 500, 'INTERNAL_ERROR');

    const prev = state.activityStates[currentActivity.id] || {};
    const nextActivityState = plugin.reduce(prev, args.actionType, args.payload || {}, {
      instanceId: args.instanceId,
      eventId: null,
      actorParticipantId: args.participantId || null,
      nowIso: new Date().toISOString(),
    });

    const nextState: AiInstanceState = {
      ...state,
      activityStates: {
        ...state.activityStates,
        [currentActivity.id]: nextActivityState,
      },
    };
    const nextRevision = Number(latest.revision) + 1;

    await query(
      `INSERT INTO ai_event_instance_actions
       (id, instance_id, activity_id, participant_id, action_type, payload_json)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5)`,
      [args.instanceId, currentActivity.id, args.participantId || null, args.actionType, args.payload || {}]
    );
    await query(
      `INSERT INTO ai_event_instance_snapshots (id, instance_id, revision, state_json)
       VALUES (uuid_generate_v4(), $1, $2, $3)`,
      [args.instanceId, nextRevision, this.toPublicSnapshot(nextState)]
    );

    await this.persistPrivateViews(args.instanceId, nextRevision, nextState);

    const privateView = args.participantId
      ? await this.getPrivateView(args.instanceId, args.participantId, nextRevision)
      : null;

    return { revision: nextRevision, state: this.toPublicSnapshot(nextState), privateView };
  }

  async getLatestState(instanceId: string, participantId?: string | null) {
    const latest = await queryOne<{ revision: number; state_json: Record<string, unknown> }>(
      `SELECT revision, state_json FROM ai_event_instance_snapshots
       WHERE instance_id = $1 ORDER BY revision DESC LIMIT 1`,
      [instanceId]
    );
    if (!latest) throw new AppError('Instance not found', 404, 'NOT_FOUND');
    const revision = Number(latest.revision);
    if (participantId) {
      const privateView = await this.getPrivateView(instanceId, participantId, revision);
      return { revision, state: latest.state_json, privateView };
    }
    return { revision, state: latest.state_json, privateView: null };
  }

  async endInstance(instanceId: string) {
    await query(
      `UPDATE ai_event_instances
       SET status = 'finished', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [instanceId]
    );
  }

  private toPublicSnapshot(state: AiInstanceState): Record<string, unknown> {
    const currentActivity = state.templateDsl.activities[state.currentActivityIndex];
    const plugin = getActivityPlugin(currentActivity.type);
    const raw = state.activityStates[currentActivity.id] || {};
    const safe = plugin?.sanitizePublic(raw) || raw;
    return {
      ...state,
      activityStates: {
        ...state.activityStates,
        [currentActivity.id]: safe,
      },
    };
  }

  private async persistPrivateViews(
    instanceId: string,
    revision: number,
    state: AiInstanceState
  ): Promise<void> {
    const participants = await query<{ participant_id: string }>(
      `SELECT participant_id FROM ai_event_instance_participants WHERE instance_id = $1`,
      [instanceId]
    );
    const currentActivity = state.templateDsl.activities[state.currentActivityIndex];
    const plugin = getActivityPlugin(currentActivity.type);
    const raw = state.activityStates[currentActivity.id] || {};
    await Promise.all(
      participants.map(async ({ participant_id }) => {
        const projected =
          plugin?.projectPrivate?.(raw, participant_id) || { activityId: currentActivity.id };
        await this.personalization.persistPrivateProjection({
          instanceId,
          participantId: participant_id,
          revision,
          payload: projected,
        });
      })
    );
  }

  private async getPrivateView(
    instanceId: string,
    participantId: string,
    revision: number
  ): Promise<Record<string, unknown> | null> {
    const row = await queryOne<{ payload_json: Record<string, unknown> }>(
      `SELECT payload_json
       FROM ai_event_private_participant_views
       WHERE instance_id = $1 AND participant_id = $2 AND revision = $3`,
      [instanceId, participantId, revision]
    );
    return (row?.payload_json as any) || null;
  }
}

import crypto from 'crypto';
