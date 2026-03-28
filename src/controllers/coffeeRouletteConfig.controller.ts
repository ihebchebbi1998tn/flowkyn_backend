/**
 * @fileoverview Coffee Roulette Configuration Controller
 *
 * HTTP request handler for all Coffee Roulette dynamic configuration endpoints.
 * Delegates business logic to CoffeeRouletteConfigService.
 *
 * Authorization:
 * - All endpoints require authenticated user (JWT)
 * - Config creation/update/delete requires admin/owner/moderator role in event organization
 * - Topic/Question management requires same role
 * - Reading config available to event participants
 *
 * Endpoints (15+):
 * Config: create, get, update, delete, getWithDetails
 * Topics: create, getAll, getOne, update, delete, reorder
 * Questions: create, getAll, getOne, update, delete, getByType
 * Mappings: assign, unassign, reorder
 * Selection: selectTopic, selectQuestion, getSessionQuestions
 * Stats: getConfigStats, getTopicStats
 */

import { Request, Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../config/database';
import {
  TopicSelectionStrategy,
  QuestionSelectionStrategy,
  CreateConfigRequest,
  UpdateConfigRequest,
  CreateTopicRequest,
  UpdateTopicRequest,
  CreateQuestionRequest,
  UpdateQuestionRequest,
} from '../types/coffeeRoulette';

const service = new CoffeeRouletteConfigService();

// ─── Authorization Helpers ────────────────────────────────────────────────────

/**
 * Verify user has access to event
 */
async function requireEventAccess(eventId: string, userId: string): Promise<any> {
  const member = await queryOne(
    `SELECT om.id as member_id, om.role_id, r.name as role_name, e.organization_id
     FROM events e
     JOIN organization_members om ON om.organization_id = e.organization_id
     JOIN roles r ON r.id = om.role_id
     WHERE e.id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [eventId, userId]
  );

  if (!member) {
    throw new AppError('You do not have access to this event', 403);
  }

  return member;
}

/**
 * Require admin/moderator role for event
 */
function requireEventAdmin(member: any) {
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('You need admin permissions to manage this configuration', 403);
  }
}

// ─────────────────────── CONFIGURATION ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/config
 * Create new Coffee Roulette configuration for an event
 */
export async function createConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId, duration_minutes, max_prompts, topic_selection_strategy, question_selection_strategy, allow_general_questions, shuffle_on_repeat } = req.body;

    if (!eventId) {
      throw new AppError('Event ID is required', 400);
    }

    // Verify access
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const config = await service.createConfig(member.member_id, {
      event_id: eventId,
      duration_minutes,
      max_prompts,
      topic_selection_strategy,
      question_selection_strategy,
      allow_general_questions,
      shuffle_on_repeat,
    });

    res.status(201).json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/config/:eventId
 * Get configuration for an event
 */
export async function getConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      throw new AppError('Event ID is required', 400);
    }

    // Verify access
    await requireEventAccess(eventId, req.user!.userId);

    const config = await service.getConfig(eventId);

    if (!config) {
      throw new AppError('Configuration not found for this event', 404);
    }

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/config/:eventId/with-details
 * Get full configuration with topics and questions
 */
export async function getConfigWithDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      throw new AppError('Event ID is required', 400);
    }

    // Verify access
    await requireEventAccess(eventId, req.user!.userId);

    const config = await service.getConfigWithDetails(eventId);

    if (!config) {
      throw new AppError('Configuration not found for this event', 404);
    }

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/coffee-roulette/config/:configId
 * Update configuration settings
 */
export async function updateConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const config = await service.updateConfig(configId, req.body, member.member_id);

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/coffee-roulette/config/:configId
 * Delete configuration
 */
export async function deleteConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteConfig(configId);

    res.json({
      success: true,
      message: 'Configuration deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── TOPIC ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/topics
 * Create a new topic
 */
export async function createTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, title, description, icon, weight, display_order } = req.body;

    if (!configId || !title) {
      throw new AppError('Config ID and title are required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const topic = await service.createTopic(
      configId,
      { config_id: configId, title, description, icon, weight, display_order },
      member.member_id
    );

    res.status(201).json({
      success: true,
      data: topic,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/topics/:configId
 * Get all topics for a configuration
 */
export async function getTopics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    const { activeOnly } = req.query;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const topics = await service.getTopics(configId, activeOnly !== 'false');

    res.json({
      success: true,
      data: topics,
      count: topics.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/topics/:topicId/with-questions
 * Get a topic with its questions
 */
export async function getTopicWithQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;

    if (!topicId) {
      throw new AppError('Topic ID is required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const topic = await service.getTopicWithQuestions(topicId);

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/coffee-roulette/topics/:topicId
 * Update a topic
 */
export async function updateTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;

    if (!topicId) {
      throw new AppError('Topic ID is required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const topic = await service.updateTopic(topicId, req.body, member.member_id);

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/coffee-roulette/topics/:topicId
 * Delete a topic
 */
export async function deleteTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;

    if (!topicId) {
      throw new AppError('Topic ID is required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteTopic(topicId);

    res.json({
      success: true,
      message: 'Topic deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── QUESTION ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/questions
 * Create a new question
 */
export async function createQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, text, category, difficulty, question_type, weight, display_order } = req.body;

    if (!configId || !text) {
      throw new AppError('Config ID and text are required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const question = await service.createQuestion(
      configId,
      { config_id: configId, text, category, difficulty, question_type, weight, display_order },
      member.member_id
    );

    res.status(201).json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/questions/:configId
 * Get all questions for a configuration
 */
export async function getQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    const { type, activeOnly } = req.query;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const questions = await service.getQuestions(
      configId,
      type as any,
      activeOnly !== 'false'
    );

    res.json({
      success: true,
      data: questions,
      count: questions.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/coffee-roulette/questions/:questionId
 * Update a question
 */
export async function updateQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { questionId } = req.params;

    if (!questionId) {
      throw new AppError('Question ID is required', 400);
    }

    // Get question's config's event
    const questionRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_questions WHERE id = $1',
      [questionId]
    );
    if (!questionRow) {
      throw new AppError('Question not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [questionRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const question = await service.updateQuestion(questionId, req.body, member.member_id);

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/coffee-roulette/questions/:questionId
 * Delete a question
 */
export async function deleteQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { questionId } = req.params;

    if (!questionId) {
      throw new AppError('Question ID is required', 400);
    }

    // Get question's config's event
    const questionRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_questions WHERE id = $1',
      [questionId]
    );
    if (!questionRow) {
      throw new AppError('Question not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [questionRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteQuestion(questionId);

    res.json({
      success: true,
      message: 'Question deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── MAPPING ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/topic-questions/assign
 * Assign a question to a topic
 */
export async function assignQuestionToTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionId, display_order } = req.body;

    if (!topicId || !questionId) {
      throw new AppError('Topic ID and Question ID are required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    const mapping = await service.assignQuestionToTopic(topicId, questionId, display_order);

    res.status(201).json({
      success: true,
      data: mapping,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/coffee-roulette/topic-questions/unassign
 * Remove a question from a topic
 */
export async function unassignQuestionFromTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionId } = req.body;

    if (!topicId || !questionId) {
      throw new AppError('Topic ID and Question ID are required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    await service.removeQuestionFromTopic(topicId, questionId);

    res.json({
      success: true,
      message: 'Question unassigned from topic successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/coffee-roulette/topic-questions/reorder
 * Reorder questions within a topic
 */
export async function reorderTopicQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionOrder } = req.body;

    if (!topicId || !Array.isArray(questionOrder)) {
      throw new AppError('Topic ID and question order array are required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    const member = await requireEventAccess(configRow.event_id, req.user!.userId);
    requireEventAdmin(member);

    await service.reorderTopicQuestions(topicId, questionOrder);

    res.json({
      success: true,
      message: 'Questions reordered successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── SELECTION ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/select-topic
 * Select a topic based on selection strategy
 */
export async function selectTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.body;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const topic = await service.selectTopic(configId);

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/coffee-roulette/select-question
 * Select a question based on selection strategy
 */
export async function selectQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, topicId } = req.body;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const question = await service.selectQuestion(configId, topicId);

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/coffee-roulette/session-questions
 * Get all questions for a session
 */
export async function getSessionQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, topicId, count } = req.body;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const questions = await service.getSessionQuestions(configId, topicId || null, count || 6);

    res.json({
      success: true,
      data: questions,
      count: questions.length,
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── STATISTICS ENDPOINTS ───────────────────────────────

/**
 * GET /api/coffee-roulette/stats/config/:configId
 * Get configuration statistics
 */
export async function getConfigStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;

    if (!configId) {
      throw new AppError('Config ID is required', 400);
    }

    // Get config's event
    const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const stats = await service.getConfigStats(configId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/coffee-roulette/stats/topic/:topicId
 * Get topic statistics
 */
export async function getTopicStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;

    if (!topicId) {
      throw new AppError('Topic ID is required', 400);
    }

    // Get topic's config's event
    const topicRow = await queryOne(
      'SELECT config_id FROM coffee_roulette_topics WHERE id = $1',
      [topicId]
    );
    if (!topicRow) {
      throw new AppError('Topic not found', 404);
    }

    const configRow = await queryOne(
      'SELECT event_id FROM coffee_roulette_config WHERE id = $1',
      [topicRow.config_id]
    );
    if (!configRow) {
      throw new AppError('Configuration not found', 404);
    }

    // Verify access
    await requireEventAccess(configRow.event_id, req.user!.userId);

    const stats = await service.getTopicStats(topicId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────── SESSION TRACKING ENDPOINTS ───────────────────────────────

/**
 * POST /api/coffee-roulette/sessions/start
 * Start tracking a pair session
 */
export async function startPairSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId, participant1Id, participant2Id, topicId } = req.body;

    if (!eventId || !participant1Id || !participant2Id) {
      throw new AppError('Event ID and both participant IDs are required', 400);
    }

    // Verify access
    await requireEventAccess(eventId, req.user!.userId);

    const session = await service.startPairSession(eventId, participant1Id, participant2Id, topicId);

    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/coffee-roulette/sessions/:sessionId/end
 * End a pair session
 */
export async function endPairSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      throw new AppError('Session ID is required', 400);
    }

    await service.endPairSession(sessionId);

    res.json({
      success: true,
      message: 'Session ended successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/coffee-roulette/sessions/:sessionId/add-question
 * Record a question used in a session
 */
export async function addQuestionToSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sessionId } = req.params;
    const { questionId } = req.body;

    if (!sessionId || !questionId) {
      throw new AppError('Session ID and question ID are required', 400);
    }

    await service.addQuestionToSession(sessionId, questionId);

    res.json({
      success: true,
      message: 'Question added to session',
    });
  } catch (error) {
    next(error);
  }
}
