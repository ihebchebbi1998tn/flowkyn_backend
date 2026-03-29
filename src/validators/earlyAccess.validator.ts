import { z } from 'zod';

export const earlyAccessSubmissionSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email').max(255),
  companyName: z.string().trim().max(255).optional().default(''),
});

export const earlyAccessAdminSendCredentialsSchema = z.object({
  personalizedMessage: z
    .string()
    .trim()
    .max(3000, 'Message is too long')
    .optional()
    .default(''),
  resetPasswordIfExists: z.boolean().optional().default(true),
});

