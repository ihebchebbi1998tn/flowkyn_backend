import { z } from 'zod';

export function validateSDP(sdp: string): boolean {
  if (!sdp || typeof sdp !== 'string') return false;
  if (sdp.length < 50) return false;
  if (sdp.length > 200000) return false;
  if (!sdp.includes('v=0')) return false;
  if (!sdp.includes('o=')) return false;
  if (!sdp.includes('m=')) return false;
  if (sdp.includes('<') || sdp.includes('>')) return false;
  if (sdp.includes('javascript:')) return false;
  if (sdp.includes('script')) return false;
  return true;
}

export const coffeeVoiceOfferSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(50, 'SDP too short - invalid format')
    .max(200000, 'SDP too large')
    .refine(validateSDP, { message: 'Invalid SDP format' }),
});

export const coffeeVoiceAnswerSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  sdp: z
    .string()
    .min(50, 'SDP too short - invalid format')
    .max(200000, 'SDP too large')
    .refine(validateSDP, { message: 'Invalid SDP format' }),
});

export const coffeeVoiceIceCandidateSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
  candidate: z
    .object({
      candidate: z
        .string()
        .max(20000)
        .refine((val) => val === '' || val.startsWith('candidate:'), {
          message: 'Invalid ICE candidate format',
        }),
      sdpMid: z.string().nullable(),
      sdpMLineIndex: z.number().int().nullable(),
      usernameFragment: z.string().nullable().optional(),
    })
    .strict(),
});

export const coffeeVoiceRequestOfferSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
});

export const coffeeVoiceHangupSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  pairId: z.string().uuid('Invalid pair ID'),
});

export const coffeeNextPromptSchema = z.object({
  expectedPromptsUsed: z.number().int().min(0, 'Expected prompts used cannot be negative').optional(),
});

export const coffeeContinueSchema = z.object({
  expectedPromptsUsed: z.number().int().min(0, 'Expected prompts used cannot be negative').optional(),
});
