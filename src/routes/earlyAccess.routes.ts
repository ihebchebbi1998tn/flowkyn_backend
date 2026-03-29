import { Router } from 'express';
import { EarlyAccessController } from '../controllers/earlyAccess.controller';
import { validate } from '../middleware/validate';
import { earlyAccessSubmissionSchema } from '../validators/earlyAccess.validator';

const router = Router();
const ctrl = new EarlyAccessController();

// Public — submit early access request
router.post('/', validate(earlyAccessSubmissionSchema), ctrl.submit);

export { router as earlyAccessRoutes };

