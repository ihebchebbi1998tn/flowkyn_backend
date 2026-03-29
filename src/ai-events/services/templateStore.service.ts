import crypto from 'crypto';
import { query, queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import type { AiTemplateRow } from '../types/template.types';
import { TemplateValidationService } from './templateValidation.service';

export class TemplateStoreService {
  private readonly validator = new TemplateValidationService();

  async createDraft(args: {
    organizationId: string;
    userId: string;
    name: string;
    goal: string;
    dsl: unknown;
  }): Promise<AiTemplateRow> {
    const validated = this.validator.validateDsl(args.dsl);
    const row = await queryOne<AiTemplateRow>(
      `INSERT INTO ai_event_templates
       (id, organization_id, created_by_user_id, name, goal, status, template_version, dsl_version, dsl_json, validation_report)
       VALUES ($1, $2, $3, $4, $5, 'validated', 1, 1, $6, $7)
       RETURNING *`,
      [crypto.randomUUID(), args.organizationId, args.userId, args.name, args.goal, validated.dsl, validated.report]
    );
    if (!row) throw new AppError('Failed to create template', 500, 'INTERNAL_ERROR');
    await query(
      `INSERT INTO ai_event_template_versions
       (id, template_id, version_number, dsl_json, change_note, created_by_user_id)
       VALUES ($1, $2, 1, $3, 'Initial version', $4)`,
      [crypto.randomUUID(), row.id, validated.dsl, args.userId]
    );
    return row;
  }

  async getById(templateId: string): Promise<AiTemplateRow> {
    const row = await queryOne<AiTemplateRow>(
      `SELECT * FROM ai_event_templates WHERE id = $1`,
      [templateId]
    );
    if (!row) throw new AppError('Template not found', 404, 'NOT_FOUND');
    return row;
  }

  async validate(templateId: string): Promise<AiTemplateRow> {
    const row = await this.getById(templateId);
    const validated = this.validator.validateDsl(row.dsl_json);
    const updated = await queryOne<AiTemplateRow>(
      `UPDATE ai_event_templates
       SET status = 'validated', validation_report = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [templateId, validated.report]
    );
    if (!updated) throw new AppError('Failed to update template validation', 500, 'INTERNAL_ERROR');
    return updated;
  }

  async publish(templateId: string): Promise<AiTemplateRow> {
    const updated = await queryOne<AiTemplateRow>(
      `UPDATE ai_event_templates
       SET status = 'published', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [templateId]
    );
    if (!updated) throw new AppError('Template not found', 404, 'NOT_FOUND');
    return updated;
  }
}
