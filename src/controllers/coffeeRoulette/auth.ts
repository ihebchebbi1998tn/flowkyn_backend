/**
 * Shared authorization helpers for Coffee Roulette controller endpoints.
 */
import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * Verify user has access to event via organization membership.
 */
export async function requireEventAccess(eventId: string, userId: string): Promise<any> {
  const member = await queryOne(
    `SELECT om.id as member_id, om.role_id, r.name as role_name, e.organization_id
     FROM events e
     JOIN organization_members om ON om.organization_id = e.organization_id
     JOIN roles r ON r.id = om.role_id
     WHERE e.id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [eventId, userId]
  );

  if (!member) {
    throw new AppError('You do not have access to this event', 403);
  }

  return member;
}

/**
 * Require admin/moderator role for event management.
 */
export function requireEventAdmin(member: any) {
  if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
    throw new AppError('You need admin permissions to manage this configuration', 403);
  }
}

/**
 * Resolve eventId from a configId.
 */
export async function getEventIdFromConfig(configId: string): Promise<string> {
  const configRow = await queryOne('SELECT event_id FROM coffee_roulette_config WHERE id = $1', [configId]);
  if (!configRow) throw new AppError('Configuration not found', 404);
  return configRow.event_id;
}

/**
 * Resolve eventId from a topicId (topic → config → event).
 */
export async function getEventIdFromTopic(topicId: string): Promise<string> {
  const topicRow = await queryOne('SELECT config_id FROM coffee_roulette_topics WHERE id = $1', [topicId]);
  if (!topicRow) throw new AppError('Topic not found', 404);
  return getEventIdFromConfig(topicRow.config_id);
}

/**
 * Resolve eventId from a questionId (question → config → event).
 */
export async function getEventIdFromQuestion(questionId: string): Promise<string> {
  const questionRow = await queryOne('SELECT config_id FROM coffee_roulette_questions WHERE id = $1', [questionId]);
  if (!questionRow) throw new AppError('Question not found', 404);
  return getEventIdFromConfig(questionRow.config_id);
}
