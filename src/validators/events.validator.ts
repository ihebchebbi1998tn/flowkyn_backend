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
  default_session_duration_minutes: z.number().int().min(1).max(240).optional(),
  two_truths_submit_seconds: z.number().int().min(5).max(600).optional(),
  two_truths_vote_seconds: z.number().int().min(5).max(600).optional(),
  coffee_chat_duration_minutes: z.number().int().min(1).max(240).optional(),
  strategic_discussion_duration_minutes: z.number().int().min(1).max(240).optional(),
  // Optional: target recipients directly by email
  invites: z.array(z.string().trim().email().max(255)).optional(),
  // Optional: target recipients by department (org-scoped UUIDs)
  invite_department_ids: z.array(z.string().uuid()).optional(),
  // Optional: game config ID (e.g. '1','2') or game key (e.g. 'coffee-roulette') for invitation links ?game=
  game_id: z.string().trim().min(1).max(50).optional(),
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
  default_session_duration_minutes: z.number().int().min(1).max(240).optional(),
  two_truths_submit_seconds: z.number().int().min(5).max(600).optional(),
  two_truths_vote_seconds: z.number().int().min(5).max(600).optional(),
  coffee_chat_duration_minutes: z.number().int().min(1).max(240).optional(),
  strategic_discussion_duration_minutes: z.number().int().min(1).max(240).optional(),
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
  // Game config ID ('1','2',...) or game key ('coffee-roulette') for invitation link ?game=
  game_id: z.string().trim().min(1).max(50).optional(),
});

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  participant_id: z.string().uuid(),
});

export const createPostSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  participant_id: z.string().uuid(),
  category: z.string().trim().max(100).optional(),
  parent_post_id: z.string().uuid().optional(),
});

export const reactToPostSchema = z.object({
  reaction_type: z.string().trim().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid reaction type'),
  participant_id: z.string().uuid(),
});

export const guestJoinSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.union([z.string().trim().email().max(255), z.literal('')]).optional().transform(v => v || undefined),
  avatar_url: z.string().max(500).optional().nullable().transform(v => v || undefined),
  token: z.string().max(255).optional(),
  guest_identity_key: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid guest identity key').optional(),
});
