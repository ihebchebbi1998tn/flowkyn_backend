import { z } from 'zod';

export const aiChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(20000),
  })
  .passthrough();

export const aiChatCompletionsSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  messages: z.array(aiChatMessageSchema).min(1).max(50),
  reasoningEnabled: z.boolean().optional(),
  jsonMode: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(8000).optional(),
});

