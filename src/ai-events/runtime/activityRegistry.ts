import type { AiTemplateActivity } from '../types/template.types';
import type { AiRuntimePlugin } from '../types/runtime.types';
import { icebreakerRuntime } from './activities/icebreaker.runtime';

const plugins = new Map<AiTemplateActivity['type'], AiRuntimePlugin>([
  ['icebreaker', icebreakerRuntime],
  ['quiz', icebreakerRuntime],
  ['voting', icebreakerRuntime],
  ['roleplay', icebreakerRuntime],
  ['retrospective', icebreakerRuntime],
]);

export function getActivityPlugin(type: AiTemplateActivity['type']): AiRuntimePlugin | null {
  return plugins.get(type) || null;
}

export function getRegisteredActivityTypes(): string[] {
  return Array.from(plugins.keys());
}
