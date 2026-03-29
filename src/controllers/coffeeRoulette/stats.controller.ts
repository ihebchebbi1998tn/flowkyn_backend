/**
 * Coffee Roulette statistics endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, getEventIdFromConfig, getEventIdFromTopic } from './auth';

const service = new CoffeeRouletteConfigService();

export async function getConfigStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const stats = await service.getConfigStats(configId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

export async function getTopicStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;
    if (!topicId) throw new AppError('Topic ID is required', 400);

    const eventId = await getEventIdFromTopic(topicId);
    await requireEventAccess(eventId, req.user!.userId);

    const stats = await service.getTopicStats(topicId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}
