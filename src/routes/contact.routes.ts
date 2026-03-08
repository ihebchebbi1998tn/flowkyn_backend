import { Router } from 'express';
import { ContactController } from '../controllers/contact.controller';
import { validate } from '../middleware/validate';
import { contactSubmissionSchema } from '../validators/contact.validator';
import { publicRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const ctrl = new ContactController();

// Public — submit contact form (rate limited)
router.post('/', publicRateLimiter, validate(contactSubmissionSchema), ctrl.submit);

export { router as contactRoutes };
