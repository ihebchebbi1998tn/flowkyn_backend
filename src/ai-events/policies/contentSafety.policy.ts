import { AppError } from '../../middleware/errorHandler';
import type { AiEventTemplateDsl } from '../types/template.types';

const BLOCKED_TERMS = ['self-harm', 'hate speech', 'violence against'];

export function assertSafeTemplateContent(dsl: AiEventTemplateDsl): void {
  const haystack = JSON.stringify(dsl).toLowerCase();
  for (const term of BLOCKED_TERMS) {
    if (haystack.includes(term)) {
      throw new AppError(
        `Generated template contains blocked content: ${term}`,
        400,
        'VALIDATION_FAILED'
      );
    }
  }
}
