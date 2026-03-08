import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateProfileSchema } from '../validators/users.validator';
import { avatarUpload } from '../config/multer';

const router = Router();
const ctrl = new UsersController();

router.get('/me', authenticate, ctrl.getProfile);
router.patch('/me', authenticate, validate(updateProfileSchema), ctrl.updateProfile);
router.post('/avatar', authenticate, avatarUpload.single('avatar'), ctrl.uploadAvatar);

export { router as usersRoutes };
