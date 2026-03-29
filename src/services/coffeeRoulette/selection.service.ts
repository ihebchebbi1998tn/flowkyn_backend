/**
 * Coffee Roulette — Selection algorithms & session tracking
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  CoffeeRouletteQuestion,
  CoffeeRoulettePairContext,
  TopicSelectionStrategy,
  QuestionSelectionStrategy,
  SelectionContext,
  SelectedQuestion,
  SelectedTopic,
  ConfigStats,
} from '../../types/coffeeRoulette';
import { getTopics } from './topic.service';
import { getQuestions, getGeneralQuestions } from './question.service';

function selectByWeight<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

export async function selectTopic(configId: string): Promise<SelectedTopic | null> {
  const config = await queryOne('SELECT * FROM coffee_roulette_config WHERE id = $1', [configId]);
  if (!config) throw new AppError('Configuration not found', 404);

  const topics = await getTopics(configId);
  if (topics.length === 0) return null;

  let selectedTopic: any;

  switch (config.topic_selection_strategy) {
    case TopicSelectionStrategy.RANDOM:
      selectedTopic = topics[Math.floor(Math.random() * topics.length)];
      break;
    case TopicSelectionStrategy.SEQUENTIAL: {
      const lastUsed = await queryOne(
        `SELECT topic_id FROM coffee_roulette_pair_context
         WHERE event_id = (SELECT event_id FROM coffee_roulette_config WHERE id = $1)
         ORDER BY session_start_time DESC LIMIT 1`,
        [configId]
      );
      if (!lastUsed?.topic_id) {
        selectedTopic = topics[0];
      } else {
        const lastIndex = topics.findIndex((t) => t.id === lastUsed.topic_id);
        selectedTopic = topics[(lastIndex + 1) % topics.length];
      }
      break;
    }
    case TopicSelectionStrategy.WEIGHTED:
      selectedTopic = selectByWeight(topics);
      break;
    default:
      selectedTopic = topics[0];
  }

  return selectedTopic;
}

export async function selectQuestion(
  configId: string,
  topicId?: string,
  context?: SelectionContext
): Promise<SelectedQuestion | null> {
  const config = await queryOne('SELECT * FROM coffee_roulette_config WHERE id = $1', [configId]);
  if (!config) throw new AppError('Configuration not found', 404);

  let questions: CoffeeRouletteQuestion[] = [];

  if (topicId) {
    questions = (await query(
      `SELECT q.* FROM coffee_roulette_questions q
       INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
       WHERE tq.topic_id = $1 AND q.is_active = true ORDER BY tq.display_order ASC`,
      [topicId]
    )) as CoffeeRouletteQuestion[];
  }

  if (questions.length === 0 && config.allow_general_questions) {
    questions = await getGeneralQuestions(configId);
  }

  if (questions.length === 0) return null;

  let selectedQuestion: any;

  switch (config.question_selection_strategy) {
    case QuestionSelectionStrategy.RANDOM:
      selectedQuestion = questions[Math.floor(Math.random() * questions.length)];
      break;
    case QuestionSelectionStrategy.SEQUENTIAL: {
      const usedIndices = context?.used_indices || new Set();
      let nextIndex = 0;
      for (let i = 0; i < questions.length; i++) {
        if (!usedIndices.has(i)) { nextIndex = i; break; }
      }
      if (usedIndices.size === questions.length && config.shuffle_on_repeat) usedIndices.clear();
      selectedQuestion = questions[nextIndex];
      usedIndices.add(nextIndex);
      break;
    }
    case QuestionSelectionStrategy.ALL:
      return { id: 'all', text: 'all', difficulty: 'easy' } as any;
    default:
      selectedQuestion = questions[0];
  }

  return selectedQuestion;
}

export async function getSessionQuestions(
  configId: string,
  topicId: string | null,
  count: number
): Promise<SelectedQuestion[]> {
  let questions: CoffeeRouletteQuestion[] = [];

  if (topicId) {
    questions = (await query(
      `SELECT q.* FROM coffee_roulette_questions q
       INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
       WHERE tq.topic_id = $1 AND q.is_active = true ORDER BY tq.display_order ASC`,
      [topicId]
    )) as CoffeeRouletteQuestion[];
  }

  const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
  const { getConfig } = await import('./configCrud.service');
  const config = await getConfig(configRow.event_id);
  if (questions.length === 0 && config?.allow_general_questions) {
    questions = await getGeneralQuestions(configId);
  }

  return questions.slice(0, count);
}

// Session tracking

export async function startPairSession(
  eventId: string,
  participant1Id: string,
  participant2Id: string,
  topicId?: string
): Promise<CoffeeRoulettePairContext> {
  const contextId = uuid();
  const result = await queryOne(
    `INSERT INTO coffee_roulette_pair_context (
      id, event_id, participant1_id, participant2_id, topic_id
    ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [contextId, eventId, participant1Id, participant2Id, topicId || null]
  );
  return result as CoffeeRoulettePairContext;
}

export async function addQuestionToSession(sessionId: string, questionId: string): Promise<void> {
  const session = await queryOne(
    'SELECT questions_used, questions_count FROM coffee_roulette_pair_context WHERE id = $1',
    [sessionId]
  );
  if (!session) throw new AppError('Session not found', 404);

  const updatedQuestions = [...(session.questions_used || []), questionId];
  await queryOne(
    `UPDATE coffee_roulette_pair_context SET questions_used = $1, questions_count = $2 WHERE id = $3`,
    [updatedQuestions, updatedQuestions.length, sessionId]
  );
}

export async function endPairSession(sessionId: string): Promise<void> {
  const now = new Date();
  const session = await queryOne(
    'SELECT session_start_time FROM coffee_roulette_pair_context WHERE id = $1',
    [sessionId]
  );
  if (!session) throw new AppError('Session not found', 404);

  const durationSeconds = Math.round((now.getTime() - new Date(session.session_start_time).getTime()) / 1000);
  await queryOne(
    `UPDATE coffee_roulette_pair_context SET session_end_time = NOW(), duration_seconds = $1, updated_at = NOW() WHERE id = $2`,
    [durationSeconds, sessionId]
  );
}

// Statistics

export async function getConfigStats(configId: string): Promise<ConfigStats> {
  const config = await queryOne('SELECT * FROM coffee_roulette_config WHERE id = $1', [configId]);
  if (!config) throw new AppError('Configuration not found', 404);

  const stats = await queryOne(
    `SELECT
      COUNT(DISTINCT CASE WHEN is_active THEN t.id END) as active_topics,
      COUNT(DISTINCT t.id) as total_topics,
      COUNT(DISTINCT CASE WHEN q.is_active THEN q.id END) as active_questions,
      COUNT(DISTINCT q.id) as total_questions,
      COUNT(DISTINCT CASE WHEN q.question_type = 'general' THEN q.id END) as general_questions,
      COUNT(DISTINCT CASE WHEN q.question_type = 'topic-specific' THEN q.id END) as topic_specific_questions,
      COUNT(DISTINCT pc.id) as total_pairings,
      ROUND(AVG(COALESCE(pc.duration_seconds, 0))) as average_duration_seconds,
      MAX(pc.session_start_time) as last_updated
    FROM coffee_roulette_config c
    LEFT JOIN coffee_roulette_topics t ON t.config_id = c.id
    LEFT JOIN coffee_roulette_questions q ON q.config_id = c.id
    LEFT JOIN coffee_roulette_pair_context pc ON pc.event_id = c.event_id
    WHERE c.id = $1`,
    [configId]
  );

  return { config_id: configId, event_id: config.event_id, ...stats } as any;
}
