import { z } from 'zod';

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  role_id: z.string().uuid('Invalid role ID'),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
