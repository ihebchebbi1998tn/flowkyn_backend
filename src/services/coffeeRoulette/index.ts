/**
 * Coffee Roulette Configuration Service — Facade
 *
 * Preserves the original CoffeeRouletteConfigService class API by delegating
 * to focused modules: configCrud, topic, question, selection, audit.
 */
import * as configCrud from './configCrud.service';
import * as topicService from './topic.service';
import * as questionService from './question.service';
import * as selectionService from './selection.service';

export class CoffeeRouletteConfigService {
  // Config CRUD
  createConfig = configCrud.createConfig;
  getConfig = configCrud.getConfig;
  getConfigWithDetails = async (eventId: string) => {
    const config = await configCrud.getConfig(eventId);
    if (!config) return null;
    const [topics, questions] = await Promise.all([
      topicService.getTopics(config.id),
      questionService.getQuestions(config.id),
    ]);
    return { ...config, topics, questions };
  };
  updateConfig = configCrud.updateConfig;
  deleteConfig = configCrud.deleteConfig;

  // Topics
  createTopic = topicService.createTopic;
  getTopics = topicService.getTopics;
  getTopicWithQuestions = topicService.getTopicWithQuestions;
  updateTopic = topicService.updateTopic;
  deleteTopic = topicService.deleteTopic;
  assignQuestionToTopic = topicService.assignQuestionToTopic;
  removeQuestionFromTopic = topicService.removeQuestionFromTopic;
  reorderTopicQuestions = topicService.reorderTopicQuestions;
  getTopicStats = topicService.getTopicStats;

  // Questions
  createQuestion = questionService.createQuestion;
  getQuestions = questionService.getQuestions;
  getGeneralQuestions = questionService.getGeneralQuestions;
  updateQuestion = questionService.updateQuestion;
  deleteQuestion = questionService.deleteQuestion;

  // Selection
  selectTopic = selectionService.selectTopic;
  selectQuestion = selectionService.selectQuestion;
  getSessionQuestions = selectionService.getSessionQuestions;

  // Session tracking
  startPairSession = selectionService.startPairSession;
  addQuestionToSession = selectionService.addQuestionToSession;
  endPairSession = selectionService.endPairSession;

  // Stats
  getConfigStats = selectionService.getConfigStats;
}

export const coffeeRouletteConfigService = new CoffeeRouletteConfigService();
