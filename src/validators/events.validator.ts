import { z } from 'zod';

export const createEventSchema = z.object({
  organization_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  event_mode: z.enum(['sync', 'async']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  max_participants: z.number().int().min(2).max(500).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
});

export const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  event_mode: z.enum(['sync', 'async']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  max_participants: z.number().int().min(2).max(500).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

export const inviteParticipantSchema = z.object({
  email: z.string().email(),
  lang: z.string().max(10).optional(),
});

export const sendMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  participant_id: z.string().uuid(),
});

export const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  participant_id: z.string().uuid(),
});

export const reactToPostSchema = z.object({
  reaction_type: z.string().min(1).max(50),
  participant_id: z.string().uuid(),
});
