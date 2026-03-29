import { queryOne } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function assertAiGenerationWithinBudget(organizationId: string): Promise<void> {
  const row = await queryOne<{ count_24h: string }>(
    `SELECT COUNT(*)::text AS count_24h
     FROM ai_generation_requests
     WHERE organization_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [organizationId]
  );
  const count = Number(row?.count_24h || 0);
  if (count >= 200) {
    throw new AppError('Daily AI generation limit reached for this organization', 429, 'RATE_LIMITED');
  }
}
