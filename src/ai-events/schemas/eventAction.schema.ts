import { z } from 'zod';

export const aiInstanceStartSchema = z.object({
  templateId: z.string().uuid(),
  eventId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1).max(1000),
  runtimeConfig: z.record(z.unknown()).optional(),
});

export const aiInstanceActionSchema = z.object({
  actionType: z.string().trim().min(1).max(80),
  payload: z.record(z.unknown()).optional(),
  participantId: z.string().uuid().optional(),
});

export const aiInstanceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const aiTemplateIdParamSchema = z.object({
  id: z.string().uuid(),
});
