import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { registerSchema, loginSchema, verifyEmailSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/auth.validator';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const ctrl = new AuthController();

router.post('/register', authRateLimiter, validate(registerSchema), ctrl.register);
router.post('/verify-email', validate(verifyEmailSchema), ctrl.verifyEmail);
router.post('/login', authRateLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.post('/logout', authenticate, ctrl.logout);
router.get('/me', authenticate, ctrl.getMe);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), ctrl.resetPassword);

export { router as authRoutes };
