import type { AiEventTemplateDsl, AiTemplateActivity } from './template.types';

export interface AiRuntimeContext {
  instanceId: string;
  eventId?: string | null;
  actorParticipantId?: string | null;
  nowIso: string;
}

export interface AiRuntimePlugin {
  type: AiTemplateActivity['type'];
  validateConfig: (config: Record<string, unknown>) => void;
  initState: (activity: AiTemplateActivity, ctx: AiRuntimeContext) => Record<string, unknown>;
  reduce: (
    state: Record<string, unknown>,
    actionType: string,
    payload: Record<string, unknown>,
    ctx: AiRuntimeContext
  ) => Record<string, unknown>;
  sanitizePublic: (state: Record<string, unknown>) => Record<string, unknown>;
  projectPrivate?: (
    state: Record<string, unknown>,
    participantId: string
  ) => Record<string, unknown> | null;
}

export interface AiInstanceState {
  hostParticipantId: string;
  presenterParticipantId: string;
  templateId: string;
  templateVersionId: string;
  currentActivityIndex: number;
  templateDsl: AiEventTemplateDsl;
  activityStates: Record<string, Record<string, unknown>>;
  status: 'waiting' | 'in_progress' | 'paused' | 'finished' | 'cancelled';
}
