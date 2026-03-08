import { Router } from 'express';
import { ContactController } from '../controllers/contact.controller';
import { validate } from '../middleware/validate';
import { contactSubmissionSchema } from '../validators/contact.validator';

const router = Router();
const ctrl = new ContactController();

// Public — submit contact form
router.post('/', validate(contactSubmissionSchema), ctrl.submit);

export { router as contactRoutes };
