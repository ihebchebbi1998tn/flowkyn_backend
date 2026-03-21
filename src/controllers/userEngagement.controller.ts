import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { userEngagementService } from '../services/userEngagement.service';
import { AuthRequest } from '../types';

const router = Router();

// All routes require super-admin authentication
router.use(authenticate);
router.use(requireSuperAdmin);

// Get user metrics
router.get('/user/:userId', async (req: Request, res: Response, next) => {
  try {
    const metrics = await userEngagementService.getOrCreateMetrics(req.params.userId);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Record user activity
router.post('/user/:userId/activity', async (req: Request, res: Response, next) => {
  try {
    const { activityType } = req.body;
    const metrics = await userEngagementService.recordActivity(req.params.userId, activityType);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Add tag to user
router.post('/user/:userId/tags', async (req: Request, res: Response, next) => {
  try {
    const { tag } = req.body;
    const metrics = await userEngagementService.addTag(req.params.userId, tag);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Remove tag from user
router.delete('/user/:userId/tags/:tag', async (req: Request, res: Response, next) => {
  try {
    const metrics = await userEngagementService.removeTag(req.params.userId, req.params.tag);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Update session duration
router.post('/user/:userId/session-duration', async (req: Request, res: Response, next) => {
  try {
    const { durationMinutes } = req.body;
    const metrics = await userEngagementService.updateSessionDuration(req.params.userId, durationMinutes);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Update streak
router.post('/user/:userId/streak', async (req: Request, res: Response, next) => {
  try {
    const metrics = await userEngagementService.updateStreak(req.params.userId);
    res.json(metrics);
  } catch (err) { next(err); }
});

// Get top users
router.get('/top', async (req: Request, res: Response, next) => {
  try {
    const { limit = '10' } = req.query;
    const users = await userEngagementService.getTopUsers(parseInt(limit as string));
    res.json(users);
  } catch (err) { next(err); }
});

// Get users by tag
router.get('/tag/:tag', async (req: Request, res: Response, next) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const result = await userEngagementService.getUsersByTag(
      req.params.tag,
      parseInt(page as string),
      parseInt(limit as string)
    );
    res.json(result);
  } catch (err) { next(err); }
});

// Get engagement timeline for user
router.get('/user/:userId/timeline', async (req: Request, res: Response, next) => {
  try {
    const { days = '30', interval = 'day' } = req.query;
    const timeline = await userEngagementService.getEngagementTimeline(
      req.params.userId,
      { days: parseInt(days as string), interval: interval as any }
    );
    res.json(timeline);
  } catch (err) { next(err); }
});

// Get engagement statistics
router.get('/stats', async (req: Request, res: Response, next) => {
  try {
    const stats = await userEngagementService.getEngagementStats();
    res.json(stats);
  } catch (err) { next(err); }
});

export default router;
