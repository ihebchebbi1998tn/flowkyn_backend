import { z } from 'zod';

export const contactSubmissionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Invalid email').max(255),
  subject: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(1, 'Message is required').max(2000),
});
