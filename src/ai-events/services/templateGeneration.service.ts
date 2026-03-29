import { query, queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { assertAiGenerationWithinBudget } from '../policies/rateLimit.policy';
import { OpenRouterProvider } from '../providers/openrouter.provider';
import { TemplateValidationService } from './templateValidation.service';
import type { AiTemplateRow } from '../types/template.types';

type GenerateArgs = {
  organizationId: string;
  userId: string;
  name: string;
  goal: string;
  context?: Record<string, unknown>;
};

export class TemplateGenerationService {
  private readonly provider = new OpenRouterProvider();
  private readonly validator = new TemplateValidationService();

  async generateTemplate(args: GenerateArgs): Promise<AiTemplateRow> {
    await assertAiGenerationWithinBudget(args.organizationId);

    const requestId = crypto.randomUUID();
    const model = process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';

    await query(
      `INSERT INTO ai_generation_requests (id, organization_id, requested_by_user_id, provider, model, input_context_json, status)
       VALUES ($1, $2, $3, 'openrouter', $4, $5, 'pending')`,
      [requestId, args.organizationId, args.userId, model, args.context || {}]
    );

    const prompt = [
      'Create JSON only. No markdown.',
      'Return a valid AI Event DSL object with dslVersion=1.',
      `Goal: ${args.goal}`,
      `Name: ${args.name}`,
      `Context: ${JSON.stringify(args.context || {})}`,
    ].join('\n');

    try {
      const completion = await this.provider.complete({
        model,
        messages: [
          { role: 'system', content: 'You generate valid event DSL JSON for collaborative team activities.' },
          { role: 'user', content: prompt },
        ],
      });

      const parsed = JSON.parse(completion.content);
      const validated = this.validator.validateDsl(parsed);

      await query(
        `INSERT INTO ai_generation_outputs (id, generation_request_id, raw_output_text, parsed_json, safety_flags_json)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), requestId, completion.content, validated.dsl, {}]
      );

      const row = await queryOne<AiTemplateRow>(
        `INSERT INTO ai_event_templates (
           id, organization_id, created_by_user_id, name, goal, status, template_version, dsl_version, dsl_json, validation_report, model_provider, model_name
         ) VALUES ($1, $2, $3, $4, $5, 'validated', 1, 1, $6, $7, 'openrouter', $8)
         RETURNING *`,
        [crypto.randomUUID(), args.organizationId, args.userId, args.name, args.goal, validated.dsl, validated.report, completion.model]
      );
      if (!row) throw new AppError('Failed to store generated template', 500, 'INTERNAL_ERROR');

      await query(
        `INSERT INTO ai_event_template_versions
         (id, template_id, version_number, dsl_json, change_note, created_by_user_id)
         VALUES ($1, $2, 1, $3, 'Initial AI generated version', $4)`,
        [crypto.randomUUID(), row.id, validated.dsl, args.userId]
      );

      await query(
        `UPDATE ai_generation_requests
         SET status = 'success', prompt_tokens = $2, completion_tokens = $3, latency_ms = $4
         WHERE id = $1`,
        [requestId, completion.promptTokens, completion.completionTokens, completion.latencyMs]
      );
      return row;
    } catch (err) {
      await query(
        `UPDATE ai_generation_requests
         SET status = 'failed', error_message = $2
         WHERE id = $1`,
        [requestId, err instanceof Error ? err.message : String(err)]
      );
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Template generation failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
        'INTERNAL_ERROR'
      );
    }
  }
}

import crypto from 'crypto';
