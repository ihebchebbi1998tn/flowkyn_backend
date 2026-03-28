import { Router } from 'express';
import { FilesController } from '../controllers/files.controller';
import { authenticate } from '../middleware/auth';
import { fileUpload } from '../config/multer';

const router = Router();
const ctrl = new FilesController();

router.post('/', authenticate, fileUpload.single('file'), ctrl.upload);
router.get('/me', authenticate, ctrl.listMyFiles);

export { router as filesRoutes };
