/**
 * Coffee Roulette selection and session tracking endpoints.
 */
import { Response, NextFunction } from 'express';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { requireEventAccess, getEventIdFromConfig } from './auth';

const service = new CoffeeRouletteConfigService();

// ─── Selection ───

export async function selectTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId } = req.body;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const topic = await service.selectTopic(configId);
    res.json({ success: true, data: topic });
  } catch (error) {
    next(error);
  }
}

export async function selectQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, topicId } = req.body;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const question = await service.selectQuestion(configId, topicId);
    res.json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function getSessionQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { configId, topicId, count } = req.body;
    if (!configId) throw new AppError('Config ID is required', 400);

    const eventId = await getEventIdFromConfig(configId);
    await requireEventAccess(eventId, req.user!.userId);

    const questions = await service.getSessionQuestions(configId, topicId || null, count || 6);
    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    next(error);
  }
}

// ─── Session Tracking ───

export async function startPairSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { eventId, participant1Id, participant2Id, topicId } = req.body;
    if (!eventId || !participant1Id || !participant2Id) throw new AppError('Event ID and both participant IDs are required', 400);

    await requireEventAccess(eventId, req.user!.userId);
    const session = await service.startPairSession(eventId, participant1Id, participant2Id, topicId);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function endPairSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sessionId } = req.params;
    if (!sessionId) throw new AppError('Session ID is required', 400);

    await service.endPairSession(sessionId);
    res.json({ success: true, message: 'Session ended successfully' });
  } catch (error) {
    next(error);
  }
}

export async function addQuestionToSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sessionId } = req.params;
    const { questionId } = req.body;
    if (!sessionId || !questionId) throw new AppError('Session ID and question ID are required', 400);

    await service.addQuestionToSession(sessionId, questionId);
    res.json({ success: true, message: 'Question added to session' });
  } catch (error) {
    next(error);
  }
}
