/**
 * Coffee Roulette — Audit logging helper
 */
import { v4 as uuid } from 'uuid';
import { queryOne } from '../../config/database';

export async function logCoffeeAudit(
  configId: string,
  memberId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValues?: any,
  newValues?: any
): Promise<void> {
  try {
    await queryOne(
      `INSERT INTO coffee_roulette_config_audit (
        id, config_id, changed_by_member_id, action, entity_type, entity_id, old_values, new_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uuid(),
        configId,
        memberId,
        action,
        entityType,
        entityId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
      ]
    );
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
}
