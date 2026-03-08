import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email('Invalid email').max(255),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be less than 128 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  lang: z.enum(['en', 'fr', 'de']).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email').max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required').max(255),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email').max(255),
  lang: z.string().max(10).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required').max(255),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be less than 128 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});
