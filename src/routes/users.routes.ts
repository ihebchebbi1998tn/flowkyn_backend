/**
 * @fileoverview Users Routes
 *
 * GET   /users/me                — Get authenticated user's profile
 * PATCH /users/me                — Update profile fields
 * POST  /users/avatar            — Upload avatar image
 * POST  /users/complete-onboarding — Mark onboarding as completed
 * GET   /users                   — List all users (authenticated)
 * GET   /users/:id               — Get user by ID
 */

import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateProfileSchema } from '../validators/users.validator';
import { uuidParam } from '../validators/common.validator';
import { avatarUpload } from '../config/multer';

const router = Router();
const ctrl = new UsersController();

router.get('/me', authenticate, ctrl.getProfile);
router.patch('/me', authenticate, validate(updateProfileSchema), ctrl.updateProfile);
router.post('/avatar', authenticate, avatarUpload.single('avatar'), ctrl.uploadAvatar);
router.post('/complete-onboarding', authenticate, ctrl.completeOnboarding);

// List users (authenticated)
router.get('/', authenticate, ctrl.listUsers);

// Get user by ID (authenticated) — validates UUID
router.get('/:id', authenticate, validate(uuidParam, 'params'), ctrl.getUserById);

export { router as usersRoutes };
