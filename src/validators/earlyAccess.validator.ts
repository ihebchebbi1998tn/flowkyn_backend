import { z } from 'zod';

export const earlyAccessSubmissionSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email').max(255),
  companyName: z.string().trim().max(255).optional().default(''),
});

