export type AiTemplateStatus = 'draft' | 'validated' | 'published' | 'archived';

export type AiActivityType =
  | 'icebreaker'
  | 'quiz'
  | 'voting'
  | 'roleplay'
  | 'retrospective';

export type AiPermissionRole = 'host' | 'presenter' | 'all';

export interface AiTemplateMeta {
  title: string;
  objective: string;
  language?: string;
  durationMinutes: number;
}

export interface AiTemplateActivity {
  id: string;
  type: AiActivityType;
  title: string;
  timingSeconds: number;
  config: Record<string, unknown>;
  transition?: {
    onComplete?: string;
    onTimeout?: string;
  };
  visibility?: 'public' | 'private-per-user';
}

export interface AiTemplatePermissions {
  canStart: AiPermissionRole;
  canAdvance: AiPermissionRole;
  canReveal: AiPermissionRole;
}

export interface AiTemplateSafety {
  forbiddenTopics?: string[];
  maxParticipants?: number;
  maxActivities?: number;
}

export interface AiEventTemplateDsl {
  dslVersion: 1;
  meta: AiTemplateMeta;
  activities: AiTemplateActivity[];
  permissions: AiTemplatePermissions;
  safety?: AiTemplateSafety;
}

export interface AiTemplateRow {
  id: string;
  organization_id: string;
  created_by_user_id: string;
  name: string;
  goal: string;
  status: AiTemplateStatus;
  template_version: number;
  dsl_version: number;
  dsl_json: AiEventTemplateDsl;
  validation_report: Record<string, unknown> | null;
  model_provider: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
}
