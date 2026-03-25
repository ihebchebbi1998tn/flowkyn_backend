import { z } from 'zod';

const activityTypeSchema = z.enum([
  'icebreaker',
  'quiz',
  'voting',
  'roleplay',
  'retrospective',
]);

const activitySchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: activityTypeSchema,
  title: z.string().trim().min(1).max(200),
  timingSeconds: z.number().int().min(5).max(7200),
  config: z.record(z.unknown()),
  transition: z
    .object({
      onComplete: z.string().trim().min(1).max(100).optional(),
      onTimeout: z.string().trim().min(1).max(100).optional(),
    })
    .optional(),
  visibility: z.enum(['public', 'private-per-user']).optional(),
});

export const aiEventTemplateDslSchema = z.object({
  dslVersion: z.literal(1),
  meta: z.object({
    title: z.string().trim().min(3).max(160),
    objective: z.string().trim().min(3).max(1000),
    language: z.string().trim().min(2).max(16).optional(),
    durationMinutes: z.number().int().min(1).max(600),
  }),
  activities: z.array(activitySchema).min(1).max(30),
  permissions: z.object({
    canStart: z.enum(['host', 'presenter', 'all']),
    canAdvance: z.enum(['host', 'presenter', 'all']),
    canReveal: z.enum(['host', 'presenter', 'all']),
  }),
  safety: z
    .object({
      forbiddenTopics: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
      maxParticipants: z.number().int().min(2).max(1000).optional(),
      maxActivities: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(3).max(140),
  goal: z.string().trim().min(3).max(2000),
  organizationId: z.string().uuid(),
  dsl: aiEventTemplateDslSchema.optional(),
});

export const generateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(140),
  goal: z.string().trim().min(3).max(2000),
  organizationId: z.string().uuid(),
  context: z.record(z.unknown()).optional(),
});
