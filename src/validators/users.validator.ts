import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  language: z.enum(['en', 'fr', 'de']).optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});
