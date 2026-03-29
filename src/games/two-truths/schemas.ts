import { z } from 'zod';

export const twoTruthsSubmitSchema = z.object({
  statements: z
    .array(
      z.string().trim().min(3, 'Each statement must be at least 3 characters').max(300, 'Each statement must be at most 300 characters')
    )
    .length(3, 'You must provide exactly 3 statements'),
  lieIndex: z.number().int().min(0).max(2).optional().default(2),
});

export const twoTruthsVoteSchema = z.object({
  statementId: z.enum(['s0', 's1', 's2'], {
    errorMap: () => ({ message: 'Invalid statement ID. Must be s0, s1, or s2' }),
  }),
});

export const twoTruthsRevealSchema = z.object({
  lieId: z
    .enum(['s0', 's1', 's2'], {
      errorMap: () => ({ message: 'Invalid lie ID. Must be s0, s1, or s2' }),
    })
    .optional(),
});
