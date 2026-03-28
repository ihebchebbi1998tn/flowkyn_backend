import { z } from 'zod';

export const gameJoinSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const gameRoundSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const gameRoundNumberSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundNumber: z.number().int().min(1, 'Invalid round number'),
});

export const gameActionSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundId: z.string().uuid('Invalid round ID').optional(),
  actionType: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_:-]+$/, 'Invalid action type'),
  payload: z
    .record(z.unknown())
    .refine((val) => JSON.stringify(val).length <= 10000, { message: 'Payload too large (max 10KB)' })
    .optional(),
});

export const gameRoundEndSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  roundId: z.string().uuid('Invalid round ID'),
});

export const gameEndSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const gameStateSyncSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});
