import { z } from 'zod';

export const createEventSchema = z.object({
  organization_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).optional().default(''),
  event_mode: z.enum(['sync', 'async']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  max_participants: z.number().int().min(2).max(500).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  allow_guests: z.boolean().optional(),
  allow_chat: z.boolean().optional(),
  auto_start_games: z.boolean().optional(),
  max_rounds: z.number().int().min(1).max(30).optional(),
  allow_participant_game_control: z.boolean().optional(),
  // Optional: target recipients directly by email
  invites: z.array(z.string().trim().email().max(255)).optional(),
  // Optional: target recipients by department (org-scoped UUIDs)
  invite_department_ids: z.array(z.string().uuid()).optional(),
}).refine((data) => {
  if (!data.start_time || !data.end_time) return true;
  return new Date(data.end_time).getTime() > new Date(data.start_time).getTime();
}, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).optional(),
  event_mode: z.enum(['sync', 'async']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  max_participants: z.number().int().min(2).max(500).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  allow_guests: z.boolean().optional(),
  allow_chat: z.boolean().optional(),
  auto_start_games: z.boolean().optional(),
  max_rounds: z.number().int().min(1).max(30).optional(),
  allow_participant_game_control: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
}).refine((data) => {
  if (!data.start_time || !data.end_time) return true;
  return new Date(data.end_time).getTime() > new Date(data.start_time).getTime();
}, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

export const inviteParticipantSchema = z.object({
  email: z.string().trim().email().max(255),
  lang: z.string().max(10).optional(),
});

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  participant_id: z.string().uuid(),
});

export const createPostSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  participant_id: z.string().uuid(),
});

export const reactToPostSchema = z.object({
  reaction_type: z.string().trim().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid reaction type'),
  participant_id: z.string().uuid(),
});

export const guestJoinSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email().max(255).optional().or(z.literal('')).transform(v => v || undefined),
  avatar_url: z.string().max(500).optional().nullable().transform(v => v || undefined),
  token: z.string().max(255).optional(),
});
