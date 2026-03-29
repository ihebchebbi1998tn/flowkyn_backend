import { NextFunction, Response } from 'express';
import { AuthRequest } from '../../types';
import { OpenRouterProvider } from '../providers/openrouter.provider';
import { AppError } from '../../middleware/errorHandler';

const provider = new OpenRouterProvider();

export class AiEventChatController {
  async completions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // authenticate middleware guarantees req.user exists here.
      const body = req.body as any;
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw new AppError('messages is required', 400, 'VALIDATION_FAILED');
      }

      const result = await provider.complete({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        jsonMode: body.jsonMode ?? false,
        reasoningEnabled: body.reasoningEnabled ?? false,
      } as any);

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

