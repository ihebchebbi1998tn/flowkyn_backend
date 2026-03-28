import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { contentModerationService } from '../services/contentModeration.service';
import { AuthRequest } from '../types';

const router = Router();

// All routes require super-admin authentication
router.use(authenticate);
router.use(requireSuperAdmin);

// Get moderation queue
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const { status, contentType, page = '1', limit = '20' } = req.query;
    const result = await contentModerationService.getModerationQueue({
      status: status as string,
      contentType: contentType as string,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Get item by ID
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const item = await contentModerationService.getModerationItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Moderation item not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// Flag content for moderation
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contentId, contentType, reason, description } = req.body;
    const result = await contentModerationService.flagContent({
      contentId, contentType, reason, description
    }, req.user!.userId);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// Approve content
router.post('/:id/approve', async (req: AuthRequest, res: Response, next) => {
  try {
    const { notes } = req.body;
    const result = await contentModerationService.approveContent(req.params.id, req.user!.userId, notes);
    res.json(result);
  } catch (err) { next(err); }
});

// Reject content
router.post('/:id/reject', async (req: AuthRequest, res: Response, next) => {
  try {
    const { notes } = req.body;
    const result = await contentModerationService.rejectContent(req.params.id, req.user!.userId, notes);
    res.json(result);
  } catch (err) { next(err); }
});

// Archive item
router.post('/:id/archive', async (req: Request, res: Response, next) => {
  try {
    const result = await contentModerationService.archiveItem(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// Get statistics
router.get('/stats', async (req: Request, res: Response, next) => {
  try {
    const stats = await contentModerationService.getModerationStats();
    res.json(stats);
  } catch (err) { next(err); }
});

// Get overdue items
router.get('/overdue', async (req: Request, res: Response, next) => {
  try {
    const { hours = '24' } = req.query;
    const items = await contentModerationService.getOverdueItems(parseInt(hours as string));
    res.json(items);
  } catch (err) { next(err); }
});

// Bulk approve
router.post('/bulk/approve', async (req: AuthRequest, res: Response, next) => {
  try {
    const { itemIds } = req.body;
    const count = await contentModerationService.bulkApprove(itemIds, req.user!.userId);
    res.json({ approved: count });
  } catch (err) { next(err); }
});

// Bulk reject
router.post('/bulk/reject', async (req: AuthRequest, res: Response, next) => {
  try {
    const { itemIds } = req.body;
    const count = await contentModerationService.bulkReject(itemIds, req.user!.userId);
    res.json({ rejected: count });
  } catch (err) { next(err); }
});

export default router;
