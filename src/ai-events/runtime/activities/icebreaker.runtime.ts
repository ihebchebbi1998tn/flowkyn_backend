import { AppError } from '../../../middleware/errorHandler';
import type { AiRuntimePlugin, AiRuntimeContext } from '../../types/runtime.types';
import type { AiTemplateActivity } from '../../types/template.types';

type IcebreakerState = {
  phase: 'prompt' | 'responses' | 'reveal';
  prompt: string;
  responses: Record<string, string>;
};

function ensureConfig(config: Record<string, unknown>): { prompt: string } {
  const prompt = typeof config.prompt === 'string' ? config.prompt.trim() : '';
  if (!prompt) {
    throw new AppError('Icebreaker config requires a prompt', 400, 'VALIDATION_FAILED');
  }
  return { prompt };
}

export const icebreakerRuntime: AiRuntimePlugin = {
  type: 'icebreaker',
  validateConfig(config: Record<string, unknown>) {
    ensureConfig(config);
  },
  initState(activity: AiTemplateActivity): Record<string, unknown> {
    const { prompt } = ensureConfig(activity.config);
    const initial: IcebreakerState = {
      phase: 'prompt',
      prompt,
      responses: {},
    };
    return initial as unknown as Record<string, unknown>;
  },
  reduce(
    state: Record<string, unknown>,
    actionType: string,
    payload: Record<string, unknown>,
    ctx: AiRuntimeContext
  ) {
    const current = state as unknown as IcebreakerState;
    if (actionType === 'icebreaker:submit') {
      if (!ctx.actorParticipantId) return state;
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) return state;
      return {
        ...current,
        phase: 'responses',
        responses: {
          ...current.responses,
          [ctx.actorParticipantId]: text.slice(0, 500),
        },
      } as unknown as Record<string, unknown>;
    }

    if (actionType === 'icebreaker:reveal') {
      return { ...current, phase: 'reveal' } as unknown as Record<string, unknown>;
    }

    return state;
  },
  sanitizePublic(state: Record<string, unknown>) {
    const current = state as unknown as IcebreakerState;
    if (current.phase === 'reveal') return state;
    return {
      ...current,
      responses: Object.keys(current.responses || {}).reduce<Record<string, string>>((acc, key) => {
        acc[key] = '[hidden]';
        return acc;
      }, {}),
    };
  },
  projectPrivate(state: Record<string, unknown>, participantId: string) {
    const current = state as unknown as IcebreakerState;
    const mine = current.responses?.[participantId];
    return mine ? { myResponse: mine } : { myResponse: null };
  },
};
