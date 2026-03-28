import { z } from 'zod';

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  industry: z.string().max(50).optional(),
  company_size: z.string().max(20).optional(),
  goals: z.array(z.string().max(50)).max(10).optional(),
});

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  industry: z.string().max(50).optional(),
  company_size: z.string().max(20).optional(),
  goals: z.array(z.string().max(50)).max(10).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  role_id: z.string().min(1, 'Role ID or name is required'),
  lang: z.string().max(10).optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(100),
});

export const departmentUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(100),
});

export const departmentIdParam = z.object({
  departmentId: z.string().uuid('Invalid UUID format'),
});
