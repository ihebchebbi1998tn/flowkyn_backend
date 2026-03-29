import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { organizationAnalyticsService } from '../services/organizationAnalytics.service';
import { AuthRequest } from '../types';

const router = Router();

// All routes require super-admin authentication
router.use(authenticate);
router.use(requireSuperAdmin);

// Get organization metrics
router.get('/org/:orgId', async (req: Request, res: Response, next) => {
  try {
    const metrics = await organizationAnalyticsService.getOrCreateMetrics(req.params.orgId);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Update health score
router.post('/org/:orgId/update-health', async (req: Request, res: Response, next) => {
  try {
    const metrics = await organizationAnalyticsService.updateHealthScore(req.params.orgId);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Update member counts
router.post('/org/:orgId/update-members', async (req: Request, res: Response, next) => {
  try {
    const metrics = await organizationAnalyticsService.updateMemberCounts(req.params.orgId);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Record organization activity
router.post('/org/:orgId/activity', async (req: Request, res: Response, next) => {
  try {
    const { activityType } = req.body;
    const metrics = await organizationAnalyticsService.recordOrgActivity(req.params.orgId, activityType);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Get top organizations
router.get('/top', async (req: Request, res: Response, next) => {
  try {
    const { limit = '10' } = req.query;
    const orgs = await organizationAnalyticsService.getTopOrganizations(parseInt(limit as string));
    res.json(orgs);
  } catch (err) { next(err); }
});

// Get at-risk organizations
router.get('/at-risk', async (req: Request, res: Response, next) => {
  try {
    const { threshold = '40' } = req.query;
    const orgs = await organizationAnalyticsService.getAtRiskOrganizations(parseInt(threshold as string));
    res.json(orgs);
  } catch (err) { next(err); }
});

// Get organization comparison
router.post('/compare', async (req: Request, res: Response, next) => {
  try {
    const { orgIds } = req.body;
    const result = await organizationAnalyticsService.getOrgComparison(orgIds);
    res.json(result);
  } catch (err) { next(err); }
});

// Get organization trends
router.get('/org/:orgId/trends', async (req: Request, res: Response, next) => {
  try {
    const { days = '30' } = req.query;
    const trends = await organizationAnalyticsService.getOrgTrends(req.params.orgId, parseInt(days as string));
    res.json(trends);
  } catch (err) { next(err); }
});

// Get dashboard data
router.get('/dashboard', async (req: Request, res: Response, next) => {
  try {
    const data = await organizationAnalyticsService.getDashboardData();
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
