import { AppError } from '../../middleware/errorHandler';
import { assertSafeTemplateContent } from '../policies/contentSafety.policy';
import { aiEventTemplateDslSchema } from '../schemas/eventTemplate.schema';
import { getActivityPlugin } from '../runtime/activityRegistry';
import type { AiEventTemplateDsl } from '../types/template.types';

export type TemplateValidationResult = {
  valid: boolean;
  report: {
    issues: string[];
    checkedAt: string;
  };
  dsl: AiEventTemplateDsl;
};

export class TemplateValidationService {
  validateDsl(input: unknown): TemplateValidationResult {
    const parsed = aiEventTemplateDslSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new AppError('Template DSL validation failed', 400, 'VALIDATION_FAILED', issues.map((m) => ({
        field: 'dsl',
        message: m,
      })));
    }
    const dsl = parsed.data as AiEventTemplateDsl;
    assertSafeTemplateContent(dsl);

    const issues: string[] = [];
    for (const activity of dsl.activities) {
      const plugin = getActivityPlugin(activity.type);
      if (!plugin) {
        issues.push(`No runtime plugin registered for activity type: ${activity.type}`);
        continue;
      }
      try {
        plugin.validateConfig(activity.config);
      } catch (err) {
        issues.push(
          err instanceof Error
            ? `Activity ${activity.id} config invalid: ${err.message}`
            : `Activity ${activity.id} config invalid`
        );
      }
    }

    if (issues.length > 0) {
      throw new AppError(
        'Template failed runtime compatibility validation',
        400,
        'VALIDATION_FAILED',
        issues.map((m) => ({ field: 'activities', message: m }))
      );
    }

    return {
      valid: true,
      report: {
        issues: [],
        checkedAt: new Date().toISOString(),
      },
      dsl,
    };
  }
}
