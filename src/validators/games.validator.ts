import { z } from 'zod';

export const startSessionSchema = z.object({
  game_type_id: z.string().uuid(),
});

export const submitActionSchema = z.object({
  game_session_id: z.string().uuid(),
  round_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  // Allow namespaced action types like "two_truths:start" or "strategic:configure"
  action_type: z.string().trim().min(1).max(50).regex(/^[a-zA-Z0-9:_-]+$/, 'Invalid action type'),
  // SECURITY: Limit payload depth and size to prevent abuse
  payload: z.record(z.unknown()).refine(
    (val) => JSON.stringify(val).length <= 10000,
    { message: 'Payload too large (max 10KB)' }
  ),
});

// Strategic Escape Challenge: configuration payload for creating a session
export const createStrategicSessionSchema = z.object({
  industry: z.string().min(1).max(50),
  crisisType: z.string().min(1).max(50),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

