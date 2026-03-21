import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { gameContentService } from '../services/gameContent.service';
import { AuthRequest } from '../types';

const router = Router();

// All routes require super-admin authentication
router.use(authenticate);
router.use(requireSuperAdmin);

// List content
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const { gameKey, contentType, difficulty, approvalStatus, page = '1', limit = '20' } = req.query;
    const result = await gameContentService.listContent({
      gameKey: gameKey as string,
      contentType: contentType as string,
      difficulty: difficulty as string,
      approvalStatus: approvalStatus as string,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Get content by ID
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const content = await gameContentService.getContent(req.params.id);
    if (!content) return res.status(404).json({ error: 'Content not found' });
    res.json(content);
  } catch (err) { next(err); }
});

// Create content
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { gameKey, contentType, title, content, difficultyLevel, category, tags } = req.body;
    const result = await gameContentService.createContent({
      gameKey, contentType, title, content, difficultyLevel, category, tags
    }, req.user!.userId);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// Update content
router.put('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await gameContentService.updateContent(req.params.id, req.body, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// Delete content
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    await gameContentService.deleteContent(req.params.id);
    res.json({ message: 'Content deleted' });
  } catch (err) { next(err); }
});

// Approve content
router.post('/:id/approve', async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await gameContentService.approveContent(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// Reject content
router.post('/:id/reject', async (req: AuthRequest, res: Response, next) => {
  try {
    const { reason } = req.body;
    const result = await gameContentService.rejectContent(req.params.id, reason, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// Game stats
router.get('/game/:gameKey/stats', async (req: Request, res: Response, next) => {
  try {
    const stats = await gameContentService.getGameContentStats(req.params.gameKey);
    res.json(stats);
  } catch (err) { next(err); }
});

// Trending content
router.get('/trending', async (req: Request, res: Response, next) => {
  try {
    const { gameKey, limit = '10', timeframeHours = '24' } = req.query;
    const result = await gameContentService.getTrendingContent({
      gameKey: gameKey as string,
      limit: parseInt(limit as string),
      timeframeHours: parseInt(timeframeHours as string),
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
