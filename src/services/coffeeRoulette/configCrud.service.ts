/**
 * Coffee Roulette — Configuration CRUD
 */
import { v4 as uuid } from 'uuid';
import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  CoffeeRouletteConfig,
  CreateConfigRequest,
  UpdateConfigRequest,
  TopicSelectionStrategy,
  QuestionSelectionStrategy,
  QuestionType,
} from '../../types/coffeeRoulette';
import { logCoffeeAudit } from './audit';

export async function createConfig(
  memberId: string,
  data: CreateConfigRequest
): Promise<CoffeeRouletteConfig> {
  try {
    const eventRow = await queryOne('SELECT id FROM events WHERE id = $1', [data.event_id]);
    if (!eventRow) throw new AppError('Event not found', 404);

    const existing = await queryOne('SELECT id FROM coffee_roulette_config WHERE event_id = $1', [data.event_id]);
    if (existing) throw new AppError('Configuration already exists for this event', 409);

    const configId = uuid();
    const result = await queryOne(
      `INSERT INTO coffee_roulette_config (
        id, event_id, duration_minutes, max_prompts,
        topic_selection_strategy, question_selection_strategy,
        allow_general_questions, shuffle_on_repeat,
        created_by_member_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        configId,
        data.event_id,
        data.duration_minutes ?? 30,
        data.max_prompts ?? 6,
        data.topic_selection_strategy ?? TopicSelectionStrategy.RANDOM,
        data.question_selection_strategy ?? QuestionSelectionStrategy.RANDOM,
        data.allow_general_questions ?? true,
        data.shuffle_on_repeat ?? true,
        memberId,
      ]
    );

    await initializeDefaultQuestions(configId, memberId);
    return result as CoffeeRouletteConfig;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Failed to create Coffee Roulette config: ${error}`, 500);
  }
}

export async function getConfig(eventId: string): Promise<CoffeeRouletteConfig | null> {
  const result = await queryOne('SELECT * FROM coffee_roulette_config WHERE event_id = $1', [eventId]);
  return result as CoffeeRouletteConfig | null;
}

export async function updateConfig(
  configId: string,
  data: UpdateConfigRequest,
  memberId: string
): Promise<CoffeeRouletteConfig> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.duration_minutes !== undefined) { updates.push(`duration_minutes = $${paramCount++}`); values.push(data.duration_minutes); }
  if (data.max_prompts !== undefined) { updates.push(`max_prompts = $${paramCount++}`); values.push(data.max_prompts); }
  if (data.topic_selection_strategy !== undefined) { updates.push(`topic_selection_strategy = $${paramCount++}`); values.push(data.topic_selection_strategy); }
  if (data.question_selection_strategy !== undefined) { updates.push(`question_selection_strategy = $${paramCount++}`); values.push(data.question_selection_strategy); }
  if (data.allow_general_questions !== undefined) { updates.push(`allow_general_questions = $${paramCount++}`); values.push(data.allow_general_questions); }
  if (data.shuffle_on_repeat !== undefined) { updates.push(`shuffle_on_repeat = $${paramCount++}`); values.push(data.shuffle_on_repeat); }

  if (updates.length === 0) {
    const config = await queryOne('SELECT * FROM coffee_roulette_config WHERE id = $1', [configId]);
    return config as CoffeeRouletteConfig;
  }

  updates.push('updated_at = NOW()');
  values.push(configId);

  const result = await queryOne(
    `UPDATE coffee_roulette_config SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  if (!result) throw new AppError('Configuration not found', 404);

  await logCoffeeAudit(configId, memberId, 'updated', 'config', configId, null, data);
  return result as CoffeeRouletteConfig;
}

export async function deleteConfig(configId: string): Promise<void> {
  const result = await queryOne('DELETE FROM coffee_roulette_config WHERE id = $1 RETURNING id', [configId]);
  if (!result) throw new AppError('Configuration not found', 404);
}

async function initializeDefaultQuestions(configId: string, memberId: string): Promise<void> {
  const defaultQuestions = [
    "What's a tiny habit that improved your life?",
    "What would you teach in a 5-minute lightning talk?",
    "What's something you're curious about lately?",
    "What's a recent win you're proud of?",
    "What's your go-to reset when you feel stuck?",
    "What's a tool you can't live without at work?",
    "What's a book or movie that stuck with you?",
    "What's a place you'd love to visit?",
  ];

  for (let i = 0; i < defaultQuestions.length; i++) {
    await queryOne(
      `INSERT INTO coffee_roulette_questions (
        id, config_id, text, question_type, display_order, created_by_member_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuid(), configId, defaultQuestions[i], QuestionType.GENERAL, i, memberId]
    );
  }
}
