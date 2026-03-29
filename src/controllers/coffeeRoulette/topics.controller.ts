/**
 * Coffee Roulette Topic endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, requireEventAdmin, getEventIdFromConfig, getEventIdFromTopic } from './auth';

const service = new CoffeeRouletteConfigService();

export async function createTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, title, description, icon, weight, display_order } = req.body;
    if (!configId || !title) throw new AppError('Config ID and title are required', 400);

    const eventId = await getEventIdFromConfig(configId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const topic = await service.createTopic(
      configId,
      { config_id: configId, title, description, icon, weight, display_order },
      member.member_id
    );
    res.status(201).json({ success: true, data: topic });
  } catch (error) {
    next(error);
  }
}

export async function getTopics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    const { activeOnly } = req.query;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const topics = await service.getTopics(configId, activeOnly !== 'false');
    res.json({ success: true, data: topics, count: topics.length });
  } catch (error) {
    next(error);
  }
}

export async function getTopicWithQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;
    if (!topicId) throw new AppError('Topic ID is required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    await requireEventAccess(eventId, req.user!.userId);

    const topic = await service.getTopicWithQuestions(topicId);
    res.json({ success: true, data: topic });
  } catch (error) {
    next(error);
  }
}

export async function updateTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;
    if (!topicId) throw new AppError('Topic ID is required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const topic = await service.updateTopic(topicId, req.body, member.member_id);
    res.json({ success: true, data: topic });
  } catch (error) {
    next(error);
  }
}

export async function deleteTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;
    if (!topicId) throw new AppError('Topic ID is required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteTopic(topicId);
    res.json({ success: true, message: 'Topic deleted successfully' });
  } catch (error) {
    next(error);
  }
}
