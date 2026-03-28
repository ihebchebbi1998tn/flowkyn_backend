import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { featureFlagsService } from '../services/featureFlags.service';
import { AuthRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/feature-flags - List all feature flags
 */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const { data, total } = await featureFlagsService.listFlags(page, limit);

    res.json({
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/feature-flags/:key - Get a specific flag
 */
router.get('/:key', async (req: Request, res: Response, next) => {
  try {
    const flag = await featureFlagsService.getFlag(req.params.key);
    if (!flag) return res.status(404).json({ error: 'Feature flag not found' });

    res.json(flag);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/feature-flags - Create a new feature flag
 */
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { key, name, description, enabled, rollout_percentage, is_multivariant, variants, targeting_rules } = req.body;

    if (!key || !name) {
      return res.status(400).json({ error: 'Key and name are required' });
    }

    const flag = await featureFlagsService.createFlag(
      {
        key,
        name,
        description,
        enabled,
        rollout_percentage,
        is_multivariant,
        variants,
        targeting_rules,
      },
      req.user!.userId
    );

    res.status(201).json(flag);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/feature-flags/:key - Update a feature flag
 */
router.put('/:key', async (req: AuthRequest, res: Response, next) => {
  try {
    const flag = await featureFlagsService.updateFlag(req.params.key, req.body, req.user!.userId);
    res.json(flag);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/feature-flags/:key - Delete a feature flag
 */
router.delete('/:key', async (req: Request, res: Response, next) => {
  try {
    await featureFlagsService.deleteFlag(req.params.key);
    res.json({ message: 'Feature flag deleted' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/feature-flags/:key/evaluate - Evaluate a flag for user/org
 */
router.post('/:key/evaluate', async (req: Request, res: Response, next) => {
  try {
    const { userId, orgId } = req.body;
    const result = await featureFlagsService.evaluateFlag(req.params.key, userId, orgId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/feature-flags/:key/stats - Get flag statistics
 */
router.get('/:key/stats', async (req: Request, res: Response, next) => {
  try {
    const stats = await featureFlagsService.getFlagStats(req.params.key);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
