import { z } from 'zod';

export const startSessionSchema = z.object({
  game_type_id: z.string().uuid(),
});

export const submitActionSchema = z.object({
  game_session_id: z.string().uuid(),
  round_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  action_type: z.string().min(1).max(50),
  payload: z.record(z.any()),
});
