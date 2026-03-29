import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../config/superAdmin';
import { analyticsReportsService } from '../services/analyticsReports.service';
import { AuthRequest } from '../types';

const router = Router();

// All routes require super-admin authentication
router.use(authenticate);
router.use(requireSuperAdmin);

// List reports
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const { reportType, page = '1', limit = '20' } = req.query;
    const result = await analyticsReportsService.listReports({
      reportType: reportType as string,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Get report by ID
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const report = await analyticsReportsService.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) { next(err); }
});

// Create custom report
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, reportType, reportData, format, scheduleFrequency } = req.body;
    const result = await analyticsReportsService.createReport({
      name, reportType, reportData, format, scheduleFrequency
    }, req.user!.userId);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// Update report
router.put('/:id', async (req: Request, res: Response, next) => {
  try {
    const result = await analyticsReportsService.updateReport(req.params.id, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// Delete report
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    await analyticsReportsService.deleteReport(req.params.id);
    res.json({ message: 'Report deleted' });
  } catch (err) { next(err); }
});

// Generate engagement report
router.post('/generate/engagement', async (req: Request, res: Response, next) => {
  try {
    const report = await analyticsReportsService.generateEngagementReport();
    res.status(201).json(report);
  } catch (err) { next(err); }
});

// Generate usage report
router.post('/generate/usage', async (req: Request, res: Response, next) => {
  try {
    const { gameKey, orgId, startDate, endDate } = req.body;
    const report = await analyticsReportsService.generateUsageReport({
      gameKey, orgId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    res.status(201).json(report);
  } catch (err) { next(err); }
});

// Generate retention report
router.post('/generate/retention', async (req: Request, res: Response, next) => {
  try {
    const report = await analyticsReportsService.generateRetentionReport();
    res.status(201).json(report);
  } catch (err) { next(err); }
});

// Export to CSV
router.get('/:id/export/csv', async (req: Request, res: Response, next) => {
  try {
    const csv = await analyticsReportsService.exportToCSV(req.params.id);
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="report-${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// Export to JSON
router.get('/:id/export/json', async (req: Request, res: Response, next) => {
  try {
    const json = await analyticsReportsService.exportToJSON(req.params.id);
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="report-${req.params.id}.json"`);
    res.send(json);
  } catch (err) { next(err); }
});

// Schedule report
router.post('/:id/schedule', async (req: Request, res: Response, next) => {
  try {
    const { frequency } = req.body;
    const report = await analyticsReportsService.scheduleReport(req.params.id, frequency);
    res.json(report);
  } catch (err) { next(err); }
});

// Get scheduled reports
router.get('/scheduled', async (req: Request, res: Response, next) => {
  try {
    const reports = await analyticsReportsService.getScheduledReports();
    res.json(reports);
  } catch (err) { next(err); }
});

export default router;
