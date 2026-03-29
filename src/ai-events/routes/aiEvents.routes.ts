import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { AiEventTemplatesController } from '../controllers/aiEventTemplates.controller';
import { AiEventInstancesController } from '../controllers/aiEventInstances.controller';
import {
  createTemplateSchema,
  generateTemplateSchema,
} from '../schemas/eventTemplate.schema';
import {
  aiInstanceActionSchema,
  aiInstanceIdParamSchema,
  aiInstanceStartSchema,
  aiTemplateIdParamSchema,
} from '../schemas/eventAction.schema';
import { aiChatCompletionsSchema } from '../schemas/aiChat.schema';
import { AiEventChatController } from '../controllers/aiEventChat.controller';

const router = Router();
const templatesCtrl = new AiEventTemplatesController();
const instancesCtrl = new AiEventInstancesController();
const chatCtrl = new AiEventChatController();

router.post('/templates', authenticate, validate(createTemplateSchema), templatesCtrl.create);
router.post('/templates/generate', authenticate, validate(generateTemplateSchema), templatesCtrl.generate);
router.get('/templates/:id', authenticate, validate(aiTemplateIdParamSchema, 'params'), templatesCtrl.getById);
router.post('/templates/:id/validate', authenticate, validate(aiTemplateIdParamSchema, 'params'), templatesCtrl.validate);
router.post('/templates/:id/publish', authenticate, validate(aiTemplateIdParamSchema, 'params'), templatesCtrl.publish);

router.post('/instances/start', authenticate, validate(aiInstanceStartSchema), instancesCtrl.start);
router.post('/instances/:id/action', authenticate, validate(aiInstanceIdParamSchema, 'params'), validate(aiInstanceActionSchema), instancesCtrl.action);
router.get('/instances/:id/state', authenticate, validate(aiInstanceIdParamSchema, 'params'), instancesCtrl.getState);
router.post('/instances/:id/end', authenticate, validate(aiInstanceIdParamSchema, 'params'), instancesCtrl.end);

// Generic OpenRouter chat (reasoning supported, JSON mode optional) — for future frontend AI messaging.
router.post('/chat/completions', authenticate, validate(aiChatCompletionsSchema), chatCtrl.completions);

export { router as aiEventsRoutes };
