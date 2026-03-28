/**
 * @fileoverview Coffee Roulette Configuration Service
 *
 * Manages dynamic Coffee Roulette configurations, topics, questions, and selection strategies.
 * Provides complete CRUD operations and intelligent selection algorithms.
 *
 * Architecture:
 * - Configuration management (create, read, update, delete)
 * - Topic management (CRUD with validation)
 * - Question management (CRUD with filtering)
 * - Topic-Question mapping (assign, unassign, reorder)
 * - Selection algorithms (random, sequential, weighted)
 * - Audit logging for compliance and debugging
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  CoffeeRouletteConfig,
  CoffeeRouletteTopic,
  CoffeeRouletteQuestion,
  CoffeeRouletteTopicQuestion,
  CoffeeRoulettePairContext,
  TopicSelectionStrategy,
  QuestionSelectionStrategy,
  QuestionType,
  CreateConfigRequest,
  UpdateConfigRequest,
  CreateTopicRequest,
  UpdateTopicRequest,
  CreateQuestionRequest,
  UpdateQuestionRequest,
  SelectionContext,
  SelectedQuestion,
  SelectedTopic,
  ConfigStats,
  TopicStats,
} from '../types/coffeeRoulette';

export class CoffeeRouletteConfigService {
  /**
   * Create a new Coffee Roulette configuration for an event.
   * Initializes with default settings and seed questions.
   */
  async createConfig(
    memberId: string,
    data: CreateConfigRequest
  ): Promise<CoffeeRouletteConfig> {
    try {
      // Validate event exists
      const eventRow = await queryOne(
        'SELECT id FROM events WHERE id = $1',
        [data.event_id]
      );
      if (!eventRow) {
        throw new AppError('Event not found', 404);
      }

      // Check if config already exists
      const existing = await queryOne(
        'SELECT id FROM coffee_roulette_config WHERE event_id = $1',
        [data.event_id]
      );
      if (existing) {
        throw new AppError('Configuration already exists for this event', 409);
      }

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

      // Initialize with default questions if none provided
      await this.initializeDefaultQuestions(configId, memberId);

      return result as CoffeeRouletteConfig;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to create Coffee Roulette config: ${error}`, 500);
    }
  }

  /**
   * Get configuration for an event
   */
  async getConfig(eventId: string): Promise<CoffeeRouletteConfig | null> {
    const result = await queryOne(
      'SELECT * FROM coffee_roulette_config WHERE event_id = $1',
      [eventId]
    );
    return result as CoffeeRouletteConfig | null;
  }

  /**
   * Get full configuration with topics and questions
   */
  async getConfigWithDetails(eventId: string): Promise<any> {
    const config = await this.getConfig(eventId);
    if (!config) return null;

    const [topics, questions] = await Promise.all([
      this.getTopics(config.id),
      this.getQuestions(config.id),
    ]);

    return {
      ...config,
      topics,
      questions,
    };
  }

  /**
   * Update configuration settings
   */
  async updateConfig(
    configId: string,
    data: UpdateConfigRequest,
    memberId: string
  ): Promise<CoffeeRouletteConfig> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramCount++}`);
      values.push(data.duration_minutes);
    }
    if (data.max_prompts !== undefined) {
      updates.push(`max_prompts = $${paramCount++}`);
      values.push(data.max_prompts);
    }
    if (data.topic_selection_strategy !== undefined) {
      updates.push(`topic_selection_strategy = $${paramCount++}`);
      values.push(data.topic_selection_strategy);
    }
    if (data.question_selection_strategy !== undefined) {
      updates.push(`question_selection_strategy = $${paramCount++}`);
      values.push(data.question_selection_strategy);
    }
    if (data.allow_general_questions !== undefined) {
      updates.push(`allow_general_questions = $${paramCount++}`);
      values.push(data.allow_general_questions);
    }
    if (data.shuffle_on_repeat !== undefined) {
      updates.push(`shuffle_on_repeat = $${paramCount++}`);
      values.push(data.shuffle_on_repeat);
    }

    if (updates.length === 0) {
      const config = await queryOne(
        'SELECT * FROM coffee_roulette_config WHERE id = $1',
        [configId]
      );
      return config as CoffeeRouletteConfig;
    }

    updates.push('updated_at = NOW()');
    values.push(configId);

    const result = await queryOne(
      `UPDATE coffee_roulette_config SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (!result) {
      throw new AppError('Configuration not found', 404);
    }

    // Audit log
    await this.logAudit(configId, memberId, 'updated', 'config', configId, null, data);

    return result as CoffeeRouletteConfig;
  }

  /**
   * Delete configuration and all related data
   */
  async deleteConfig(configId: string): Promise<void> {
    const result = await queryOne(
      'DELETE FROM coffee_roulette_config WHERE id = $1 RETURNING id',
      [configId]
    );

    if (!result) {
      throw new AppError('Configuration not found', 404);
    }
  }

  // ─────────────────────── TOPICS ───────────────────────

  /**
   * Create a new topic
   */
  async createTopic(
    configId: string,
    data: CreateTopicRequest,
    memberId: string
  ): Promise<CoffeeRouletteTopic> {
    const topicId = uuid();

    // Get max display_order for this config
    const lastTopic = await queryOne(
      `SELECT MAX(display_order) as max_order FROM coffee_roulette_topics 
       WHERE config_id = $1`,
      [configId]
    );
    const displayOrder = data.display_order ?? ((lastTopic?.max_order ?? -1) + 1);

    const result = await queryOne(
      `INSERT INTO coffee_roulette_topics (
        id, config_id, title, description, icon, weight, display_order,
        created_by_member_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        topicId,
        configId,
        data.title,
        data.description || null,
        data.icon || null,
        data.weight ?? 1,
        displayOrder,
        memberId,
      ]
    );

    // Audit log
    await this.logAudit(configId, memberId, 'created', 'topic', topicId, null, data);

    return result as CoffeeRouletteTopic;
  }

  /**
   * Get all topics for a configuration
   */
  async getTopics(
    configId: string,
    activeOnly = true
  ): Promise<CoffeeRouletteTopic[]> {
    let sql =
      `SELECT * FROM coffee_roulette_topics 
       WHERE config_id = $1`;
    const params = [configId];

    if (activeOnly) {
      sql += ` AND is_active = true`;
    }

    sql += ` ORDER BY display_order ASC`;

    const results = await query(sql, params);
    return results as CoffeeRouletteTopic[];
  }

  /**
   * Get a single topic with its questions
   */
  async getTopicWithQuestions(
    topicId: string
  ): Promise<any> {
    const topic = await queryOne(
      'SELECT * FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );

    if (!topic) {
      throw new AppError('Topic not found', 404);
    }

    const questions = await query(
      `SELECT q.* FROM coffee_roulette_questions q
       INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
       WHERE tq.topic_id = $1
       ORDER BY tq.display_order ASC`,
      [topicId]
    );

    return {
      ...topic,
      questions,
    };
  }

  /**
   * Update a topic
   */
  async updateTopic(
    topicId: string,
    data: UpdateTopicRequest,
    memberId: string
  ): Promise<CoffeeRouletteTopic> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(data.description);
    }
    if (data.icon !== undefined) {
      updates.push(`icon = $${paramCount++}`);
      values.push(data.icon);
    }
    if (data.weight !== undefined) {
      updates.push(`weight = $${paramCount++}`);
      values.push(data.weight);
    }
    if (data.display_order !== undefined) {
      updates.push(`display_order = $${paramCount++}`);
      values.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(data.is_active);
    }

    if (updates.length === 0) {
      const topic = await queryOne(
        'SELECT * FROM coffee_roulette_topics WHERE id = $1',
        [topicId]
      );
      return topic as CoffeeRouletteTopic;
    }

    updates.push('updated_at = NOW()');
    values.push(topicId);

    const result = await queryOne(
      `UPDATE coffee_roulette_topics SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (!result) {
      throw new AppError('Topic not found', 404);
    }

    // Get config_id for audit
    const config_id = result.config_id;
    await this.logAudit(config_id, memberId, 'updated', 'topic', topicId, null, data);

    return result as CoffeeRouletteTopic;
  }

  /**
   * Delete a topic
   */
  async deleteTopic(topicId: string): Promise<void> {
    const result = await queryOne(
      'DELETE FROM coffee_roulette_topics WHERE id = $1 RETURNING id',
      [topicId]
    );

    if (!result) {
      throw new AppError('Topic not found', 404);
    }
  }

  // ─────────────────────── QUESTIONS ───────────────────────

  /**
   * Create a new question
   */
  async createQuestion(
    configId: string,
    data: CreateQuestionRequest,
    memberId: string
  ): Promise<CoffeeRouletteQuestion> {
    const questionId = uuid();

    // Get max display_order for this config
    const lastQuestion = await queryOne(
      `SELECT MAX(display_order) as max_order FROM coffee_roulette_questions
       WHERE config_id = $1`,
      [configId]
    );
    const displayOrder = data.display_order ?? ((lastQuestion?.max_order ?? -1) + 1);

    const result = await queryOne(
      `INSERT INTO coffee_roulette_questions (
        id, config_id, text, category, difficulty, question_type,
        weight, display_order, created_by_member_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        questionId,
        configId,
        data.text,
        data.category || null,
        data.difficulty || 'easy',
        data.question_type || QuestionType.GENERAL,
        data.weight ?? 1,
        displayOrder,
        memberId,
      ]
    );

    // Audit log
    await this.logAudit(configId, memberId, 'created', 'question', questionId, null, data);

    return result as CoffeeRouletteQuestion;
  }

  /**
   * Get all questions for a configuration
   */
  async getQuestions(
    configId: string,
    type?: QuestionType,
    activeOnly = true
  ): Promise<CoffeeRouletteQuestion[]> {
    let sql = `SELECT * FROM coffee_roulette_questions WHERE config_id = $1`;
    const params = [configId];
    let paramCount = 2;

    if (type) {
      sql += ` AND question_type = $${paramCount++}`;
      params.push(type);
    }

    if (activeOnly) {
      sql += ` AND is_active = true`;
    }

    sql += ` ORDER BY display_order ASC`;

    const results = await query(sql, params);
    return results as CoffeeRouletteQuestion[];
  }

  /**
   * Get general questions for a configuration
   */
  async getGeneralQuestions(configId: string): Promise<CoffeeRouletteQuestion[]> {
    return this.getQuestions(configId, QuestionType.GENERAL);
  }

  /**
   * Update a question
   */
  async updateQuestion(
    questionId: string,
    data: UpdateQuestionRequest,
    memberId: string
  ): Promise<CoffeeRouletteQuestion> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.text !== undefined) {
      updates.push(`text = $${paramCount++}`);
      values.push(data.text);
    }
    if (data.category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(data.category);
    }
    if (data.difficulty !== undefined) {
      updates.push(`difficulty = $${paramCount++}`);
      values.push(data.difficulty);
    }
    if (data.question_type !== undefined) {
      updates.push(`question_type = $${paramCount++}`);
      values.push(data.question_type);
    }
    if (data.weight !== undefined) {
      updates.push(`weight = $${paramCount++}`);
      values.push(data.weight);
    }
    if (data.display_order !== undefined) {
      updates.push(`display_order = $${paramCount++}`);
      values.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(data.is_active);
    }

    if (updates.length === 0) {
      const question = await queryOne(
        'SELECT * FROM coffee_roulette_questions WHERE id = $1',
        [questionId]
      );
      return question as CoffeeRouletteQuestion;
    }

    updates.push('updated_at = NOW()');
    values.push(questionId);

    const result = await queryOne(
      `UPDATE coffee_roulette_questions SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (!result) {
      throw new AppError('Question not found', 404);
    }

    // Get config_id for audit
    const config_id = result.config_id;
    await this.logAudit(config_id, memberId, 'updated', 'question', questionId, null, data);

    return result as CoffeeRouletteQuestion;
  }

  /**
   * Delete a question
   */
  async deleteQuestion(questionId: string): Promise<void> {
    const result = await queryOne(
      'DELETE FROM coffee_roulette_questions WHERE id = $1 RETURNING id',
      [questionId]
    );

    if (!result) {
      throw new AppError('Question not found', 404);
    }
  }

  // ─────────────────────── TOPIC-QUESTION MAPPING ───────────────────────

  /**
   * Assign a question to a topic
   */
  async assignQuestionToTopic(
    topicId: string,
    questionId: string,
    displayOrder?: number
  ): Promise<CoffeeRouletteTopicQuestion> {
    // Verify both exist
    const [topic, question] = await Promise.all([
      queryOne('SELECT * FROM coffee_roulette_topics WHERE id = $1', [topicId]),
      queryOne('SELECT * FROM coffee_roulette_questions WHERE id = $1', [questionId]),
    ]);

    if (!topic) throw new AppError('Topic not found', 404);
    if (!question) throw new AppError('Question not found', 404);

    // Check already assigned
    const existing = await queryOne(
      'SELECT id FROM coffee_roulette_topic_questions WHERE topic_id = $1 AND question_id = $2',
      [topicId, questionId]
    );
    if (existing) {
      throw new AppError('Question already assigned to this topic', 409);
    }

    // Get max order if not provided
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
      `INSERT INTO coffee_roulette_topic_questions (
        id, topic_id, question_id, display_order
      ) VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [mappingId, topicId, questionId, order]
    );

    return result as CoffeeRouletteTopicQuestion;
  }

  /**
   * Remove a question from a topic
   */
  async removeQuestionFromTopic(topicId: string, questionId: string): Promise<void> {
    const result = await queryOne(
      'DELETE FROM coffee_roulette_topic_questions WHERE topic_id = $1 AND question_id = $2 RETURNING id',
      [topicId, questionId]
    );

    if (!result) {
      throw new AppError('Question not assigned to this topic', 404);
    }
  }

  /**
   * Reorder questions within a topic
   */
  async reorderTopicQuestions(
    topicId: string,
    questionOrder: { questionId: string; displayOrder: number }[]
  ): Promise<void> {
    for (const item of questionOrder) {
      await queryOne(
        `UPDATE coffee_roulette_topic_questions 
         SET display_order = $1 
         WHERE topic_id = $2 AND question_id = $3`,
        [item.displayOrder, topicId, item.questionId]
      );
    }
  }

  // ─────────────────────── SELECTION ALGORITHMS ───────────────────────

  /**
   * Select a topic based on the configuration's strategy
   */
  async selectTopic(configId: string): Promise<SelectedTopic | null> {
    const config = await queryOne(
      'SELECT * FROM coffee_roulette_config WHERE id = $1',
      [configId]
    );

    if (!config) {
      throw new AppError('Configuration not found', 404);
    }

    const topics = await this.getTopics(configId);
    if (topics.length === 0) {
      return null;
    }

    let selectedTopic: any;

    switch (config.topic_selection_strategy) {
      case TopicSelectionStrategy.RANDOM:
        selectedTopic = topics[Math.floor(Math.random() * topics.length)];
        break;

      case TopicSelectionStrategy.SEQUENTIAL:
        // Get last used topic, select next
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
          const nextIndex = (lastIndex + 1) % topics.length;
          selectedTopic = topics[nextIndex];
        }
        break;

      case TopicSelectionStrategy.WEIGHTED:
        selectedTopic = this.selectByWeight(topics);
        break;

      default:
        selectedTopic = topics[0];
    }

    return selectedTopic;
  }

  /**
   * Select a question based on the configuration's strategy
   */
  async selectQuestion(
    configId: string,
    topicId?: string,
    context?: SelectionContext
  ): Promise<SelectedQuestion | null> {
    const config = await queryOne(
      'SELECT * FROM coffee_roulette_config WHERE id = $1',
      [configId]
    );

    if (!config) {
      throw new AppError('Configuration not found', 404);
    }

    let questions: CoffeeRouletteQuestion[] = [];

    // Get topic-specific or general questions
    if (topicId) {
      questions = await query(
        `SELECT q.* FROM coffee_roulette_questions q
         INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
         WHERE tq.topic_id = $1 AND q.is_active = true
         ORDER BY tq.display_order ASC`,
        [topicId]
      ) as CoffeeRouletteQuestion[];
    }

    // Fallback to general questions if topic-specific not available
    if (questions.length === 0 && config.allow_general_questions) {
      questions = await this.getGeneralQuestions(configId);
    }

    if (questions.length === 0) {
      return null;
    }

    let selectedQuestion: any;

    switch (config.question_selection_strategy) {
      case QuestionSelectionStrategy.RANDOM:
        selectedQuestion = questions[Math.floor(Math.random() * questions.length)];
        break;

      case QuestionSelectionStrategy.SEQUENTIAL:
        // Get last used question in this session
        const usedIndices = context?.used_indices || new Set();
        let nextIndex = 0;

        for (let i = 0; i < questions.length; i++) {
          if (!usedIndices.has(i)) {
            nextIndex = i;
            break;
          }
        }

        if (usedIndices.size === questions.length && config.shuffle_on_repeat) {
          usedIndices.clear();
        }

        selectedQuestion = questions[nextIndex];
        usedIndices.add(nextIndex);
        break;

      case QuestionSelectionStrategy.ALL:
        // Return all questions
        return { id: 'all', text: 'all', difficulty: 'easy' } as any;

      default:
        selectedQuestion = questions[0];
    }

    return selectedQuestion;
  }

  /**
   * Get next N questions for a session
   */
  async getSessionQuestions(
    configId: string,
    topicId: string | null,
    count: number
  ): Promise<SelectedQuestion[]> {
    let questions: CoffeeRouletteQuestion[] = [];

    // Get topic-specific questions if topic provided
    if (topicId) {
      questions = await query(
        `SELECT q.* FROM coffee_roulette_questions q
         INNER JOIN coffee_roulette_topic_questions tq ON tq.question_id = q.id
         WHERE tq.topic_id = $1 AND q.is_active = true
         ORDER BY tq.display_order ASC`,
        [topicId]
      ) as CoffeeRouletteQuestion[];
    }

    // Fallback to general questions
    const config = await this.getConfig((await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId])).event_id);
    if (questions.length === 0 && config?.allow_general_questions) {
      questions = await this.getGeneralQuestions(configId);
    }

    // Apply selection strategy
    const config_data = await queryOne('SELECT question_selection_strategy FROM coffee_roulette_config WHERE id = $1', [configId]);
    let selected: SelectedQuestion[] = [];

    if (config_data?.question_selection_strategy === QuestionSelectionStrategy.ALL) {
      selected = questions.slice(0, count);
    } else {
      // Random or sequential - just take first N
      selected = questions.slice(0, count);
    }

    return selected;
  }

  /**
   * Select an item by weight using weighted random selection
   */
  private selectByWeight<T extends { weight: number }>(items: T[]): T {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;

    for (const item of items) {
      random -= item.weight;
      if (random <= 0) {
        return item;
      }
    }

    return items[items.length - 1];
  }

  // ─────────────────────── SESSION TRACKING ───────────────────────

  /**
   * Start tracking a pair's chat session
   */
  async startPairSession(
    eventId: string,
    participant1Id: string,
    participant2Id: string,
    topicId?: string
  ): Promise<CoffeeRoulettePairContext> {
    const contextId = uuid();

    const result = await queryOne(
      `INSERT INTO coffee_roulette_pair_context (
        id, event_id, participant1_id, participant2_id, topic_id
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [contextId, eventId, participant1Id, participant2Id, topicId || null]
    );

    return result as CoffeeRoulettePairContext;
  }

  /**
   * Record a question used in a session
   */
  async addQuestionToSession(
    sessionId: string,
    questionId: string
  ): Promise<void> {
    const session = await queryOne(
      'SELECT questions_used, questions_count FROM coffee_roulette_pair_context WHERE id = $1',
      [sessionId]
    );

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const updatedQuestions = [...(session.questions_used || []), questionId];

    await queryOne(
      `UPDATE coffee_roulette_pair_context
       SET questions_used = $1, questions_count = $2
       WHERE id = $3`,
      [updatedQuestions, updatedQuestions.length, sessionId]
    );
  }

  /**
   * End a pair session
   */
  async endPairSession(sessionId: string): Promise<void> {
    const now = new Date();
    const session = await queryOne(
      'SELECT session_start_time FROM coffee_roulette_pair_context WHERE id = $1',
      [sessionId]
    );

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const durationSeconds = Math.round(
      (now.getTime() - new Date(session.session_start_time).getTime()) / 1000
    );

    await queryOne(
      `UPDATE coffee_roulette_pair_context
       SET session_end_time = NOW(), duration_seconds = $1, updated_at = NOW()
       WHERE id = $2`,
      [durationSeconds, sessionId]
    );
  }

  // ─────────────────────── STATISTICS & REPORTING ───────────────────────

  /**
   * Get comprehensive statistics for a configuration
   */
  async getConfigStats(configId: string): Promise<ConfigStats> {
    const config = await queryOne(
      'SELECT * FROM coffee_roulette_config WHERE id = $1',
      [configId]
    );

    if (!config) {
      throw new AppError('Configuration not found', 404);
    }

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

    return {
      config_id: configId,
      event_id: config.event_id,
      ...stats,
    } as any;
  }

  /**
   * Get statistics for a topic
   */
  async getTopicStats(topicId: string): Promise<TopicStats> {
    const topic = await queryOne(
      'SELECT * FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );

    if (!topic) {
      throw new AppError('Topic not found', 404);
    }

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
      WHERE t.id = $1
      GROUP BY t.id`,
      [topicId]
    );

    return {
      topic_id: topicId,
      title: topic.title,
      ...stats,
    } as any;
  }

  // ─────────────────────── PRIVATE HELPERS ───────────────────────

  /**
   * Initialize configuration with default seed questions
   */
  private async initializeDefaultQuestions(
    configId: string,
    memberId: string
  ): Promise<void> {
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
        [
          uuid(),
          configId,
          defaultQuestions[i],
          QuestionType.GENERAL,
          i,
          memberId,
        ]
      );
    }
  }

  /**
   * Log configuration changes for audit trail
   */
  private async logAudit(
    configId: string,
    memberId: string,
    action: string,
    entityType: string,
    entityId: string,
    oldValues?: any,
    newValues?: any
  ): Promise<void> {
    try {
      await queryOne(
        `INSERT INTO coffee_roulette_config_audit (
          id, config_id, changed_by_member_id, action, entity_type, entity_id, old_values, new_values
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuid(),
          configId,
          memberId,
          action,
          entityType,
          entityId,
          oldValues ? JSON.stringify(oldValues) : null,
          newValues ? JSON.stringify(newValues) : null,
        ]
      );
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.error('Failed to log audit:', error);
    }
  }
}

export const coffeeRouletteConfigService = new CoffeeRouletteConfigService();
