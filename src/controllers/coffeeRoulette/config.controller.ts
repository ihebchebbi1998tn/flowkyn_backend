/**
 * Coffee Roulette Configuration CRUD endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, requireEventAdmin, getEventIdFromConfig } from './auth';

const service = new CoffeeRouletteConfigService();

export async function createConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId, duration_minutes, max_prompts, topic_selection_strategy, question_selection_strategy, allow_general_questions, shuffle_on_repeat } = req.body;
    if (!eventId) throw new AppError('Event ID is required', 400);

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

    res.status(201).json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

export async function getConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId } = req.params;
    if (!eventId) throw new AppError('Event ID is required', 400);

    await requireEventAccess(eventId, req.user!.userId);
    const config = await service.getConfig(eventId);
    if (!config) throw new AppError('Configuration not found for this event', 404);

    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

export async function getConfigWithDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId } = req.params;
    if (!eventId) throw new AppError('Event ID is required', 400);

    await requireEventAccess(eventId, req.user!.userId);
    const config = await service.getConfigWithDetails(eventId);
    if (!config) throw new AppError('Configuration not found for this event', 404);

    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

export async function updateConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const config = await service.updateConfig(configId, req.body, member.member_id);
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

export async function deleteConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteConfig(configId);
    res.json({ success: true, message: 'Configuration deleted successfully' });
  } catch (error) {
    next(error);
  }
}
