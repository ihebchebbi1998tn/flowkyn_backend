/**
 * @fileoverview Common Validation Schemas
 *
 * Reusable Zod schemas for validating common request parameters:
 * - UUID path params (id, eventId, orgId, etc.)
 * - Pagination query params (page, limit)
 */

import { z } from 'zod';

/** Validates a single `id` path parameter as a UUID */
export const uuidParam = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

/** Validates `sessionId` path parameter as a UUID */
export const sessionIdParam = z.object({
  sessionId: z.string().uuid('Invalid UUID format'),
});

/** Validates `eventId` path parameter as a UUID */
export const eventIdParam = z.object({
  eventId: z.string().uuid('Invalid UUID format'),
});

/** Validates `orgId` path parameter as a UUID */
export const orgIdParam = z.object({
  orgId: z.string().uuid('Invalid UUID format'),
});

/** Validates `postId` path parameter as a UUID */
export const postIdParam = z.object({
  postId: z.string().uuid('Invalid UUID format'),
});

/** Validates `memberId` path parameter as a UUID */
export const memberIdParam = z.object({
  memberId: z.string().uuid('Invalid UUID format'),
});

/** Validates `configId` path parameter as a UUID */
export const configIdParam = z.object({
  configId: z.string().uuid('Invalid UUID format'),
});

/** Validates `topicId` path parameter as a UUID */
export const topicIdParam = z.object({
  topicId: z.string().uuid('Invalid UUID format'),
});

/** Validates `questionId` path parameter as a UUID */
export const questionIdParam = z.object({
  questionId: z.string().uuid('Invalid UUID format'),
});

/** Validates `orgId` + `memberId` path parameters */
export const orgMemberParams = z.object({
  orgId: z.string().uuid('Invalid UUID format'),
  memberId: z.string().uuid('Invalid UUID format'),
});

/** Validates pagination query params */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
