/**
 * Coffee Roulette Question endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, requireEventAdmin, getEventIdFromConfig, getEventIdFromQuestion } from './auth';

const service = new CoffeeRouletteConfigService();

export async function createQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, text, category, difficulty, question_type, weight, display_order } = req.body;
    if (!configId || !text) throw new AppError('Config ID and text are required', 400);

    const eventId = await getEventIdFromConfig(configId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const question = await service.createQuestion(
      configId,
      { config_id: configId, text, category, difficulty, question_type, weight, display_order },
      member.member_id
    );
    res.status(201).json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function getQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.params;
    const { type, activeOnly } = req.query;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const questions = await service.getQuestions(configId, type as any, activeOnly !== 'false');
    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    next(error);
  }
}

export async function updateQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { questionId } = req.params;
    if (!questionId) throw new AppError('Question ID is required', 400);

    const eventId = await getEventIdFromQuestion(questionId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    const question = await service.updateQuestion(questionId, req.body, member.member_id);
    res.json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function deleteQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { questionId } = req.params;
    if (!questionId) throw new AppError('Question ID is required', 400);

    const eventId = await getEventIdFromQuestion(questionId);
    const member = await requireEventAccess(eventId, req.user!.userId);
    requireEventAdmin(member);

    await service.deleteQuestion(questionId);
    res.json({ success: true, message: 'Question deleted successfully' });
  } catch (error) {
    next(error);
  }
}
