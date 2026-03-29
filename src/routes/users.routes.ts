/**
 * @fileoverview Users Routes
 *
 * GET   /users/me                — Get authenticated user's profile
 * PATCH /users/me                — Update profile fields
 * DELETE /users/me               — Delete own account (soft-delete)
 * POST  /users/avatar            — Upload avatar image
 * POST  /users/change-password   — Change password (requires current password)
 * POST  /users/complete-onboarding — Mark onboarding as completed
 * POST  /users/onboarding-invites — Send team invitations during onboarding
 * GET   /users/sessions          — List active sessions
 * DELETE /users/sessions          — Revoke all sessions
 * DELETE /users/sessions/:sessionId — Revoke a specific session
 * PATCH /users/notification-preferences — Update notification preferences
 * GET   /users                   — List org members (authenticated, scoped)
 * GET   /users/:id               — Get user by ID
 */

import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { SessionsController } from '../controllers/sessions.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateProfileSchema, changePasswordSchema } from '../validators/users.validator';
import { uuidParam } from '../validators/common.validator';
import { avatarUpload } from '../config/multer';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const ctrl = new UsersController();
const sessionsCtrl = new SessionsController();

router.get('/me', authenticate, ctrl.getProfile);
router.patch('/me', authenticate, validate(updateProfileSchema), ctrl.updateProfile);
router.delete('/me', authenticate, authRateLimiter, ctrl.deleteAccount);
router.post('/avatar', authenticate, avatarUpload.single('avatar'), ctrl.uploadAvatar);
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);
router.post('/complete-onboarding', authenticate, ctrl.completeOnboarding);
router.post('/onboarding-invites', authenticate, ctrl.sendOnboardingInvites);

// Session management
router.get('/sessions', authenticate, sessionsCtrl.listSessions);
router.delete('/sessions', authenticate, sessionsCtrl.revokeAllSessions);
router.delete('/sessions/:sessionId', authenticate, sessionsCtrl.revokeSession);

// Notification preferences
router.patch('/notification-preferences', authenticate, ctrl.updateNotificationPreferences);
router.get('/notification-preferences', authenticate, ctrl.getNotificationPreferences);

// List users (authenticated — scoped to user's organization)
router.get('/', authenticate, ctrl.listUsers);

// Get user by ID (authenticated) — validates UUID
router.get('/:id', authenticate, validate(uuidParam, 'params'), ctrl.getUserById);

export { router as usersRoutes };
