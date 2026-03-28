/**
 * @fileoverview Coffee Roulette Configuration Routes
 *
 * Defines all API routes for Coffee Roulette dynamic configuration management.
 * All routes require authentication via JWT middleware.
 *
 * Route Structure:
 * POST   /api/coffee-roulette/config                    Create config
 * GET    /api/coffee-roulette/config/:eventId           Get config
 * GET    /api/coffee-roulette/config/:eventId/with-details Get config with details
 * PATCH  /api/coffee-roulette/config/:configId          Update config
 * DELETE /api/coffee-roulette/config/:configId          Delete config
 *
 * Topics:
 * POST   /api/coffee-roulette/topics                    Create topic
 * GET    /api/coffee-roulette/topics/:configId          Get all topics
 * GET    /api/coffee-roulette/topics/:topicId/details   Get topic with questions
 * PATCH  /api/coffee-roulette/topics/:topicId           Update topic
 * DELETE /api/coffee-roulette/topics/:topicId           Delete topic
 *
 * Questions:
 * POST   /api/coffee-roulette/questions                 Create question
 * GET    /api/coffee-roulette/questions/:configId       Get all questions
 * PATCH  /api/coffee-roulette/questions/:questionId     Update question
 * DELETE /api/coffee-roulette/questions/:questionId     Delete question
 *
 * Mappings:
 * POST   /api/coffee-roulette/topic-questions/assign    Assign question to topic
 * DELETE /api/coffee-roulette/topic-questions/unassign  Remove question from topic
 * POST   /api/coffee-roulette/topic-questions/reorder   Reorder questions
 *
 * Selection:
 * POST   /api/coffee-roulette/select-topic              Select topic
 * POST   /api/coffee-roulette/select-question           Select question
 * POST   /api/coffee-roulette/session-questions         Get session questions
 *
 * Statistics:
 * GET    /api/coffee-roulette/stats/config/:configId    Get config stats
 * GET    /api/coffee-roulette/stats/topic/:topicId      Get topic stats
 *
 * Sessions:
 * POST   /api/coffee-roulette/sessions/start            Start pair session
 * POST   /api/coffee-roulette/sessions/:sessionId/end   End session
 * POST   /api/coffee-roulette/sessions/:sessionId/add-question Add question to session
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/coffeeRouletteConfig.controller';
import { configIdParam, eventIdParam, questionIdParam, sessionIdParam, topicIdParam } from '../validators/common.validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─────────────────────── CONFIGURATION ───────────────────────────────

router.post('/config', controller.createConfig);
router.get('/config/:eventId', validate(eventIdParam, 'params'), controller.getConfig);
router.get('/config/:eventId/with-details', validate(eventIdParam, 'params'), controller.getConfigWithDetails);
router.patch('/config/:configId', validate(configIdParam, 'params'), controller.updateConfig);
router.delete('/config/:configId', validate(configIdParam, 'params'), controller.deleteConfig);

// ─────────────────────── TOPICS ───────────────────────────────

router.post('/topics', controller.createTopic);
router.get('/topics/:configId', validate(configIdParam, 'params'), controller.getTopics);
router.get('/topics/:topicId/details', validate(topicIdParam, 'params'), controller.getTopicWithQuestions);
router.patch('/topics/:topicId', validate(topicIdParam, 'params'), controller.updateTopic);
router.delete('/topics/:topicId', validate(topicIdParam, 'params'), controller.deleteTopic);

// ─────────────────────── QUESTIONS ───────────────────────────────

router.post('/questions', controller.createQuestion);
router.get('/questions/:configId', validate(configIdParam, 'params'), controller.getQuestions);
router.patch('/questions/:questionId', validate(questionIdParam, 'params'), controller.updateQuestion);
router.delete('/questions/:questionId', validate(questionIdParam, 'params'), controller.deleteQuestion);

// ─────────────────────── MAPPINGS ───────────────────────────────

router.post('/topic-questions/assign', controller.assignQuestionToTopic);
router.delete('/topic-questions/unassign', controller.unassignQuestionFromTopic);
router.post('/topic-questions/reorder', controller.reorderTopicQuestions);

// ─────────────────────── SELECTION ───────────────────────────────

router.post('/select-topic', controller.selectTopic);
router.post('/select-question', controller.selectQuestion);
router.post('/session-questions', controller.getSessionQuestions);

// ─────────────────────── STATISTICS ───────────────────────────────

router.get('/stats/config/:configId', validate(configIdParam, 'params'), controller.getConfigStats);
router.get('/stats/topic/:topicId', validate(topicIdParam, 'params'), controller.getTopicStats);

// ─────────────────────── SESSION TRACKING ───────────────────────────────

router.post('/sessions/start', controller.startPairSession);
router.post('/sessions/:sessionId/end', validate(sessionIdParam, 'params'), controller.endPairSession);
router.post('/sessions/:sessionId/add-question', validate(sessionIdParam, 'params'), controller.addQuestionToSession);

export default router;
