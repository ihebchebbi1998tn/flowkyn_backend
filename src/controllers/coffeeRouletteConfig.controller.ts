/**
 * @fileoverview Coffee Roulette Configuration Controller — Facade
 *
 * Re-exports all handler functions from split sub-modules for backward compatibility.
 * The routes file imports `* as controller from '../controllers/coffeeRouletteConfig.controller'`.
 */

// Config CRUD
export { createConfig, getConfig, getConfigWithDetails, updateConfig, deleteConfig } from './coffeeRoulette/config.controller';

// Topics
export { createTopic, getTopics, getTopicWithQuestions, updateTopic, deleteTopic } from './coffeeRoulette/topics.controller';

// Questions
export { createQuestion, getQuestions, updateQuestion, deleteQuestion } from './coffeeRoulette/questions.controller';

// Mappings
export { assignQuestionToTopic, unassignQuestionFromTopic, reorderTopicQuestions } from './coffeeRoulette/mappings.controller';

// Selection & Session Tracking
export { selectTopic, selectQuestion, getSessionQuestions, startPairSession, endPairSession, addQuestionToSession } from './coffeeRoulette/selection.controller';

// Statistics
export { getConfigStats, getTopicStats } from './coffeeRoulette/stats.controller';
