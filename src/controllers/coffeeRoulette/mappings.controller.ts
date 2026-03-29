/**
 * Coffee Roulette topic-question mapping endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, requireEventAdmin, getEventIdFromTopic } from './auth';

const service = new CoffeeRouletteConfigService();

export async function assignQuestionToTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionId, display_order } = req.body;
    if (!topicId || !questionId) throw new AppError('Topic ID and Question ID are required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const mapping = await service.assignQuestionToTopic(topicId, questionId, display_order);
    res.status(201).json({ success: true, data: mapping });
  } catch (error) {
    next(error);
  }
}

export async function unassignQuestionFromTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionId } = req.body;
    if (!topicId || !questionId) throw new AppError('Topic ID and Question ID are required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    await service.removeQuestionFromTopic(topicId, questionId);
    res.json({ success: true, message: 'Question unassigned from topic successfully' });
  } catch (error) {
    next(error);
  }
}

export async function reorderTopicQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionOrder } = req.body;
    if (!topicId || !Array.isArray(questionOrder)) throw new AppError('Topic ID and question order array are required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    await service.reorderTopicQuestions(topicId, questionOrder);
    res.json({ success: true, message: 'Questions reordered successfully' });
  } catch (error) {
    next(error);
  }
}
