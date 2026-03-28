import { NextFunction, Response } from 'express';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { TemplateStoreService } from '../services/templateStore.service';
import { TemplateGenerationService } from '../services/templateGeneration.service';
import { assertCanManageAiEvents } from '../policies/permission.policy';

const store = new TemplateStoreService();
const generator = new TemplateGenerationService();

export class AiEventTemplatesController {
  async generate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_MISSING_TOKEN');
      const { organizationId, name, goal, context } = req.body;
      await assertCanManageAiEvents(organizationId, req.user.userId);
      const template = await generator.generateTemplate({
        organizationId,
        userId: req.user.userId,
        name,
        goal,
        context,
      });
      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_MISSING_TOKEN');
      const { organizationId, name, goal, dsl } = req.body;
      await assertCanManageAiEvents(organizationId, req.user.userId);
      const template = await store.createDraft({
        organizationId,
        userId: req.user.userId,
        name,
        goal,
        dsl,
      });
      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await store.getById(req.params.id);
      res.json(template);
    } catch (err) {
      next(err);
    }
  }

  async validate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await store.validate(req.params.id);
      res.json(template);
    } catch (err) {
      next(err);
    }
  }

  async publish(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await store.publish(req.params.id);
      res.json(template);
    } catch (err) {
      next(err);
    }
  }
}
