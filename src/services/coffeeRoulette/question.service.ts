/**
 * Coffee Roulette — Question CRUD
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  CoffeeRouletteQuestion,
  CreateQuestionRequest,
  UpdateQuestionRequest,
  QuestionType,
} from '../../types/coffeeRoulette';
import { logCoffeeAudit } from './audit';

export async function createQuestion(
  configId: string,
  data: CreateQuestionRequest,
  memberId: string
): Promise<CoffeeRouletteQuestion> {
  const questionId = uuid();
  const lastQuestion = await queryOne(
    `SELECT MAX(display_order) as max_order FROM coffee_roulette_questions WHERE config_id = $1`,
    [configId]
  );
  const displayOrder = data.display_order ?? ((lastQuestion?.max_order ?? -1) + 1);

  const result = await queryOne(
    `INSERT INTO coffee_roulette_questions (
      id, config_id, text, category, difficulty, question_type, weight, display_order, created_by_member_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [questionId, configId, data.text, data.category || null, data.difficulty || 'easy', data.question_type || QuestionType.GENERAL, data.weight ?? 1, displayOrder, memberId]
  );

  await logCoffeeAudit(configId, memberId, 'created', 'question', questionId, null, data);
  return result as CoffeeRouletteQuestion;
}

export async function getQuestions(
  configId: string,
  type?: QuestionType,
  activeOnly = true
): Promise<CoffeeRouletteQuestion[]> {
  let sql = `SELECT * FROM coffee_roulette_questions WHERE config_id = $1`;
  const params: any[] = [configId];
  let paramCount = 2;

  if (type) { sql += ` AND question_type = $${paramCount++}`; params.push(type); }
  if (activeOnly) sql += ` AND is_active = true`;
  sql += ` ORDER BY display_order ASC`;

  return (await query(sql, params)) as CoffeeRouletteQuestion[];
}

export async function getGeneralQuestions(configId: string): Promise<CoffeeRouletteQuestion[]> {
  return getQuestions(configId, QuestionType.GENERAL);
}

export async function updateQuestion(
  questionId: string,
  data: UpdateQuestionRequest,
  memberId: string
): Promise<CoffeeRouletteQuestion> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.text !== undefined) { updates.push(`text = $${paramCount++}`); values.push(data.text); }
  if (data.category !== undefined) { updates.push(`category = $${paramCount++}`); values.push(data.category); }
  if (data.difficulty !== undefined) { updates.push(`difficulty = $${paramCount++}`); values.push(data.difficulty); }
  if (data.question_type !== undefined) { updates.push(`question_type = $${paramCount++}`); values.push(data.question_type); }
  if (data.weight !== undefined) { updates.push(`weight = $${paramCount++}`); values.push(data.weight); }
  if (data.display_order !== undefined) { updates.push(`display_order = $${paramCount++}`); values.push(data.display_order); }
  if (data.is_active !== undefined) { updates.push(`is_active = $${paramCount++}`); values.push(data.is_active); }

  if (updates.length === 0) {
    const question = await queryOne('SELECT * FROM coffee_roulette_questions WHERE id = $1', [questionId]);
    return question as CoffeeRouletteQuestion;
  }

  updates.push('updated_at = NOW()');
  values.push(questionId);

  const result = await queryOne(
    `UPDATE coffee_roulette_questions SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  if (!result) throw new AppError('Question not found', 404);

  await logCoffeeAudit(result.config_id, memberId, 'updated', 'question', questionId, null, data);
  return result as CoffeeRouletteQuestion;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const result = await queryOne('DELETE FROM coffee_roulette_questions WHERE id = $1 RETURNING id', [questionId]);
  if (!result) throw new AppError('Question not found', 404);
}
