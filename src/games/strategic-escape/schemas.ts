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
  // Accept frontend aliases (industry/crisis/difficulty) and map to keys
  industry: z.string().max(200).optional(),
  crisis: z.string().max(200).optional(),
  difficulty: z.string().max(100).optional(),
}).transform((data) => ({
  industryKey: data.industryKey ?? data.industry ?? undefined,
  crisisKey: data.crisisKey ?? data.crisis ?? undefined,
  difficultyKey: data.difficultyKey ?? (data.difficulty as any) ?? undefined,
  industryLabel: data.industryLabel ?? data.industry ?? undefined,
  crisisLabel: data.crisisLabel ?? data.crisis ?? undefined,
  difficultyLabel: data.difficultyLabel ?? data.difficulty ?? undefined,
}));

export const strategicAssignRolesSchema = z.object({
  roles: z
    .record(z.string(), z.string().max(50, 'Role key too long'))
    .optional()
    .default({}),
});

export const strategicStartDiscussionSchema = z.object({
  durationMinutes: z.number().int().min(1).max(480).optional(),
}).optional().default({});

export const strategicEndDiscussionSchema = z.object({}).optional().default({});
