import { Router } from 'express';
import { FilesController } from '../controllers/files.controller';
import { authenticate } from '../middleware/auth';
import { fileUpload } from '../config/multer';
import { uploadRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const ctrl = new FilesController();

router.post('/', authenticate, uploadRateLimiter, fileUpload.single('file'), ctrl.upload);
router.get('/me', authenticate, ctrl.listMyFiles);

export { router as filesRoutes };
