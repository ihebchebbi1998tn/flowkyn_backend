/**
 * Feature Flags Service
 * Manages feature toggles, gradual rollouts, and A/B testing
 */

import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rollout_percentage: number;
  is_multivariant: boolean;
  variants?: Record<string, { percentage: number; config: unknown }>;
  targeting_rules?: { org_ids?: string[]; user_ids?: string[]; user_tags?: string[] };
  created_at: string;
  updated_at: string;
}

export class FeatureFlagsService {
  /**
   * Get a feature flag by key
   */
  async getFlag(key: string): Promise<FeatureFlag | null> {
    try {
      const result = await query<FeatureFlag>(
        'SELECT * FROM feature_flags WHERE key = $1 AND deleted_at IS NULL',
        [key]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get feature flag: ${key}`, 500);
    }
  }

  /**
   * List all feature flags with pagination
   */
  async listFlags(page: number = 1, limit: number = 20): Promise<{ data: FeatureFlag[]; total: number }> {
    try {
      const offset = (page - 1) * limit;
      const [flags, counts] = await Promise.all([
        query<FeatureFlag>('SELECT * FROM feature_flags WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2', [
          limit,
          offset,
        ]),
        query<{ count: string }>('SELECT COUNT(*) FROM feature_flags WHERE deleted_at IS NULL'),
      ]);
      return { data: flags, total: Number(counts[0]?.count || 0) };
    } catch (err) {
      throw new AppError('Failed to list feature flags', 500);
    }
  }

  /**
   * Create a new feature flag
   */
  async createFlag(
    data: {
      key: string;
      name: string;
      description?: string;
      enabled?: boolean;
      rollout_percentage?: number;
      is_multivariant?: boolean;
      variants?: Record<string, { percentage: number; config: unknown }>;
      targeting_rules?: { org_ids?: string[]; user_ids?: string[]; user_tags?: string[] };
    },
    createdBy: string
  ): Promise<FeatureFlag> {
    try {
      const result = await query<FeatureFlag>(
        `INSERT INTO feature_flags (key, name, description, enabled, rollout_percentage, is_multivariant, variants, targeting_rules, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          data.key,
          data.name,
          data.description || null,
          data.enabled || false,
          data.rollout_percentage || 0,
          data.is_multivariant || false,
          data.variants ? JSON.stringify(data.variants) : null,
          data.targeting_rules ? JSON.stringify(data.targeting_rules) : null,
          createdBy,
        ]
      );
      return result[0];
    } catch (err: any) {
      if (err.code === '23505') {
        throw new AppError(`Feature flag key already exists: ${data.key}`, 400);
      }
      throw new AppError('Failed to create feature flag', 500);
    }
  }

  /**
   * Update a feature flag
   */
  async updateFlag(
    key: string,
    data: Partial<Omit<FeatureFlag, 'id' | 'created_at' | 'updated_at'>>,
    updatedBy: string
  ): Promise<FeatureFlag> {
    try {
      const flag = await this.getFlag(key);
      if (!flag) throw new AppError(`Feature flag not found: ${key}`, 404);

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramCount = 1;

      Object.entries(data).forEach(([field, value]) => {
        if (value !== undefined) {
          updates.push(`${field} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      updates.push(`updated_by = $${paramCount}`);
      updates.push(`updated_at = NOW()`);
      values.push(updatedBy);
      values.push(key);

      const result = await query<FeatureFlag>(
        `UPDATE feature_flags SET ${updates.join(', ')} WHERE key = $${paramCount + 1} RETURNING *`,
        values
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update feature flag: ${key}`, 500);
    }
  }

  /**
   * Delete a feature flag (soft delete)
   */
  async deleteFlag(key: string): Promise<void> {
    try {
      const flag = await this.getFlag(key);
      if (!flag) throw new AppError(`Feature flag not found: ${key}`, 404);

      await query('UPDATE feature_flags SET deleted_at = NOW() WHERE key = $1', [key]);
    } catch (err) {
      throw new AppError(`Failed to delete feature flag: ${key}`, 500);
    }
  }

  /**
   * Evaluate if a user should see a feature
   */
  async evaluateFlag(flagKey: string, userId?: string, orgId?: string): Promise<{ enabled: boolean; variant?: string }> {
    try {
      const flag = await this.getFlag(flagKey);
      if (!flag) return { enabled: false };

      // Feature is globally disabled
      if (!flag.enabled && flag.rollout_percentage === 0) {
        return { enabled: false };
      }

      // Check targeting rules
      if (flag.targeting_rules) {
        const rules = flag.targeting_rules as any;
        if (rules.user_ids && userId && !rules.user_ids.includes(userId)) {
          return { enabled: false };
        }
        if (rules.org_ids && orgId && !rules.org_ids.includes(orgId)) {
          return { enabled: false };
        }
      }

      // Rollout percentage check
      if (flag.rollout_percentage < 100) {
        const hash = this.hashUserId(userId || orgId || 'anonymous');
        if (hash % 100 >= flag.rollout_percentage) {
          return { enabled: false };
        }
      }

      // Determine variant for A/B testing
      let variant: string | undefined;
      if (flag.is_multivariant && flag.variants) {
        variant = this.selectVariant(flag.variants, userId || orgId || 'anonymous');
      }

      // Log evaluation for analytics
      if (userId || orgId) {
        await this.logEvaluation(flag.id, userId, orgId, variant);
      }

      return { enabled: true, variant };
    } catch (err) {
      // Fail open - if flag service fails, don't block features
      console.error(`Failed to evaluate flag ${flagKey}:`, err);
      return { enabled: false };
    }
  }

  /**
   * Get flag statistics and rollout metrics
   */
  async getFlagStats(flagKey: string): Promise<{
    total_evaluations: number;
    enabled_count: number;
    variant_distribution: Record<string, number>;
  }> {
    try {
      const result = await query<any>(
        `SELECT 
          COUNT(*) as total_evaluations,
          SUM(CASE WHEN assigned_variant IS NOT NULL THEN 1 ELSE 0 END) as enabled_count,
          assigned_variant,
          COUNT(*) as variant_count
         FROM feature_flag_evaluations
         WHERE flag_id = (SELECT id FROM feature_flags WHERE key = $1)
         GROUP BY assigned_variant`,
        [flagKey]
      );

      const distribution: Record<string, number> = {};
      let totalEvaluations = 0;
      let enabledCount = 0;

      result.forEach((row) => {
        if (row.assigned_variant) {
          distribution[row.assigned_variant] = Number(row.variant_count);
        }
        totalEvaluations = Number(row.total_evaluations);
        enabledCount = Number(row.enabled_count || 0);
      });

      return { total_evaluations: totalEvaluations, enabled_count: enabledCount, variant_distribution: distribution };
    } catch (err) {
      throw new AppError('Failed to get flag statistics', 500);
    }
  }

  /**
   * Private: Hash user ID for consistent rollout
   */
  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Private: Select variant based on user ID
   */
  private selectVariant(variants: Record<string, { percentage: number }>, userId: string): string {
    const hash = this.hashUserId(userId) % 100;
    let cumulative = 0;

    for (const [variant, config] of Object.entries(variants)) {
      cumulative += config.percentage;
      if (hash < cumulative) {
        return variant;
      }
    }

    return Object.keys(variants)[0];
  }

  /**
   * Private: Log flag evaluation for analytics
   */
  private async logEvaluation(flagId: string, userId?: string, orgId?: string, variant?: string): Promise<void> {
    try {
      await query(
        'INSERT INTO feature_flag_evaluations (flag_id, user_id, organization_id, assigned_variant) VALUES ($1, $2, $3, $4)',
        [flagId, userId || null, orgId || null, variant || null]
      );
    } catch (err) {
      console.error('Failed to log flag evaluation:', err);
    }
  }
}

export const featureFlagsService = new FeatureFlagsService();
