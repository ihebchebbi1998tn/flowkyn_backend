import { z } from 'zod';

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  industry: z.string().max(50).optional(),
  company_size: z.string().max(20).optional(),
  goals: z.array(z.string().max(50)).max(10).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  role_id: z.string().uuid('Invalid role ID'),
  lang: z.string().max(10).optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
