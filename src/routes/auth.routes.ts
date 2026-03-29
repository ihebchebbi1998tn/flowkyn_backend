import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authRateLimiter, publicRateLimiter } from '../middleware/rateLimiter';
import { registerSchema, loginSchema, verifyEmailSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/auth.validator';

const router = Router();
const ctrl = new AuthController();

// Public auth endpoints with stricter rate limiting
router.post('/register', authRateLimiter, validate(registerSchema), ctrl.register);
router.post('/verify-email', authRateLimiter, validate(verifyEmailSchema), ctrl.verifyEmail);
router.post('/login', authRateLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', publicRateLimiter, validate(refreshSchema), ctrl.refresh);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), ctrl.resetPassword);
router.post('/resend-verification', authRateLimiter, validate(forgotPasswordSchema), ctrl.resendVerification);

// Authenticated endpoints
router.post('/logout', authenticate, ctrl.logout);
router.get('/me', authenticate, ctrl.getMe);

export { router as authRoutes };
