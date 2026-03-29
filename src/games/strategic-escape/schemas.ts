import { z } from 'zod';

export const strategicConfigureSchema = z.object({
  industryKey: z.string().max(100, 'Industry key too long').optional(),
  crisisKey: z.string().max(100, 'Crisis key too long').optional(),
  difficultyKey: z
    .enum(['easy', 'medium', 'hard'], {
      errorMap: () => ({ message: 'Difficulty must be easy, medium, or hard' }),
    })
    .optional(),
  industryLabel: z.string().max(200, 'Industry label too long').optional(),
  crisisLabel: z.string().max(200, 'Crisis label too long').optional(),
  difficultyLabel: z.string().max(100, 'Difficulty label too long').optional(),
});

export const strategicAssignRolesSchema = z.object({
  roles: z
    .record(z.string().uuid('Invalid participant ID'), z.string().max(50, 'Role key too long'))
    .refine((roles) => Object.keys(roles).length > 0, { message: 'At least one role must be assigned' }),
});
