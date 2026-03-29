/**
 * Coffee Roulette — Topic CRUD
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  CoffeeRouletteTopic,
  CoffeeRouletteTopicQuestion,
  CreateTopicRequest,
  UpdateTopicRequest,
  TopicStats,
} from '../../types/coffeeRoulette';
import { logCoffeeAudit } from './audit';

export async function createTopic(
  configId: string,
  data: CreateTopicRequest,
  memberId: string
): Promise<CoffeeRouletteTopic> {
  const topicId = uuid();
  const lastTopic = await queryOne(
    `SELECT MAX(display_order) as max_order FROM coffee_roulette_topics WHERE config_id = $1`,
    [configId]
  );
  const displayOrder = data.display_order ?? ((lastTopic?.max_order ?? -1) + 1);

  const result = await queryOne(
    `INSERT INTO coffee_roulette_topics (
      id, config_id, title, description, icon, weight, display_order, created_by_member_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [topicId, configId, data.title, data.description || null, data.icon || null, data.weight ?? 1, displayOrder, memberId]
  );

  await logCoffeeAudit(configId, memberId, 'created', 'topic', topicId, null, data);
  return result as CoffeeRouletteTopic;
}

export async function getTopics(configId: string, activeOnly = true): Promise<CoffeeRouletteTopic[]> {
  let sql = `SELECT * FROM coffee_roulette_topics WHERE config_id = $1`;
  if (activeOnly) sql += ` AND is_active = true`;
  sql += ` ORDER BY display_order ASC`;
  return (await query(sql, [configId])) as CoffeeRouletteTopic[];
}

export async function getTopicWithQuestions(topicId: string): Promise<any> {
  const topic = await queryOne('SELECT * FROM coffee_roulette_topics WHERE id = $1', [topicId]);
  if (!topic) throw new AppError('Topic not found', 404);

  const questions = await query(
    `SELECT q.* FROM coffee_roulette_questions q
     INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
     WHERE tq.topic_id = $1 ORDER BY tq.display_order ASC`,
    [topicId]
  );
  return { ...topic, questions };
}

export async function updateTopic(
  topicId: string,
  data: UpdateTopicRequest,
  memberId: string
): Promise<CoffeeRouletteTopic> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.title !== undefined) { updates.push(`title = $${paramCount++}`); values.push(data.title); }
  if (data.description !== undefined) { updates.push(`description = $${paramCount++}`); values.push(data.description); }
  if (data.icon !== undefined) { updates.push(`icon = $${paramCount++}`); values.push(data.icon); }
  if (data.weight !== undefined) { updates.push(`weight = $${paramCount++}`); values.push(data.weight); }
  if (data.display_order !== undefined) { updates.push(`display_order = $${paramCount++}`); values.push(data.display_order); }
  if (data.is_active !== undefined) { updates.push(`is_active = $${paramCount++}`); values.push(data.is_active); }

  if (updates.length === 0) {
    const topic = await queryOne('SELECT * FROM coffee_roulette_topics WHERE id = $1', [topicId]);
    return topic as CoffeeRouletteTopic;
  }

  updates.push('updated_at = NOW()');
  values.push(topicId);

  const result = await queryOne(
    `UPDATE coffee_roulette_topics SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  if (!result) throw new AppError('Topic not found', 404);

  await logCoffeeAudit(result.config_id, memberId, 'updated', 'topic', topicId, null, data);
  return result as CoffeeRouletteTopic;
}

export async function deleteTopic(topicId: string): Promise<void> {
  const result = await queryOne('DELETE FROM coffee_roulette_topics WHERE id = $1 RETURNING id', [topicId]);
  if (!result) throw new AppError('Topic not found', 404);
}

// Topic-Question mapping

export async function assignQuestionToTopic(
  topicId: string,
  questionId: string,
  displayOrder?: number
): Promise<CoffeeRouletteTopicQuestion> {
  const [topic, question] = await Promise.all([
    queryOne('SELECT * FROM coffee_roulette_topics WHERE id = $1', [topicId]),
    queryOne('SELECT * FROM coffee_roulette_questions WHERE id = $1', [questionId]),
  ]);
  if (!topic) throw new AppError('Topic not found', 404);
  if (!question) throw new AppError('Question not found', 404);

  const existing = await queryOne(
    'SELECT id FROM coffee_roulette_topic_questions WHERE topic_id = $1 AND question_id = $2',
    [topicId, questionId]
  );
  if (existing) throw new AppError('Question already assigned to this topic', 409);

  let order = displayOrder;
  if (order === undefined) {
    const maxOrder = await queryOne(
      'SELECT MAX(display_order) as max_order FROM coffee_roulette_topic_questions WHERE topic_id = $1',
      [topicId]
    );
    order = (maxOrder?.max_order ?? -1) + 1;
  }

  const mappingId = uuid();
  const result = await queryOne(
    `INSERT INTO coffee_roulette_topic_questions (id, topic_id, question_id, display_order) VALUES ($1, $2, $3, $4) RETURNING *`,
    [mappingId, topicId, questionId, order]
  );
  return result as CoffeeRouletteTopicQuestion;
}

export async function removeQuestionFromTopic(topicId: string, questionId: string): Promise<void> {
  const result = await queryOne(
    'DELETE FROM coffee_roulette_topic_questions WHERE topic_id = $1 AND question_id = $2 RETURNING id',
    [topicId, questionId]
  );
  if (!result) throw new AppError('Question not assigned to this topic', 404);
}

export async function reorderTopicQuestions(
  topicId: string,
  questionOrder: { questionId: string; displayOrder: number }[]
): Promise<void> {
  for (const item of questionOrder) {
    await queryOne(
      `UPDATE coffee_roulette_topic_questions SET display_order = $1 WHERE topic_id = $2 AND question_id = $3`,
      [item.displayOrder, topicId, item.questionId]
    );
  }
}

export async function getTopicStats(topicId: string): Promise<TopicStats> {
  const topic = await queryOne('SELECT * FROM coffee_roulette_topics WHERE id = $1', [topicId]);
  if (!topic) throw new AppError('Topic not found', 404);

  const stats = await queryOne(
    `SELECT
      COUNT(DISTINCT tq.question_id) as total_questions,
      COUNT(DISTINCT pc.id) as times_selected,
      ROUND(AVG(COALESCE(q.difficulty, 0))) as average_difficulty,
      MAX(pc.session_start_time) as last_used
    FROM coffee_roulette_topics t
    LEFT JOIN coffee_roulette_topic_questions tq ON tq.topic_id = t.id
    LEFT JOIN coffee_roulette_questions q ON q.id = tq.question_id
    LEFT JOIN coffee_roulette_pair_context pc ON pc.topic_id = t.id
    WHERE t.id = $1 GROUP BY t.id`,
    [topicId]
  );

  return { topic_id: topicId, title: topic.title, ...stats } as any;
}
