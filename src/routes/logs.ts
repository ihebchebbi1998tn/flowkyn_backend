import express from 'express';
import { getAllLogs, getMetrics } from '../monitor/store';
import { env } from '../config/env';

const router = express.Router();

// Password-based authentication middleware
const logsAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const password = process.env.LOGS_PASSWORD || 'Flowkyn2026';
  const providedPassword = req.query.password as string;

  if (!providedPassword) {
    return res.status(401).json({
      error: 'Password required',
      message: 'Please provide password parameter: /logs?password=YOUR_PASSWORD',
      code: 'AUTH_REQUIRED',
      statusCode: 401,
    });
  }

  if (providedPassword !== password) {
    return res.status(403).json({
      error: 'Invalid password',
      message: 'The provided password is incorrect',
      code: 'AUTH_FAILED',
      statusCode: 403,
    });
  }

  next();
};

// ──── GET /logs - View all logs with optional filtering ────
router.get('/', logsAuthMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 1000);
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const filterStatus = req.query.status as string;
  const filterPath = req.query.path as string;
  const filterMethod = req.query.method as string;
  const filterError = req.query.error as string;

  let allLogs = getAllLogs();

  // Apply filters
  if (filterStatus) {
    allLogs = allLogs.filter(log => log.statusCode.toString().startsWith(filterStatus));
  }
  if (filterPath) {
    allLogs = allLogs.filter(log => log.path.includes(filterPath));
  }
  if (filterMethod) {
    allLogs = allLogs.filter(log => log.method.toUpperCase() === filterMethod.toUpperCase());
  }
  if (filterError === 'true') {
    allLogs = allLogs.filter(log => log.statusCode >= 400 || log.error);
  }

  const total = allLogs.length;
  const paginatedLogs = allLogs.slice(Math.max(0, total - offset - limit), total - offset);

  res.json({
    success: true,
    data: {
      total,
      limit,
      offset,
      count: paginatedLogs.length,
      logs: paginatedLogs.reverse(), // Most recent first
    },
    filters: {
      status: filterStatus || undefined,
      path: filterPath || undefined,
      method: filterMethod || undefined,
      error: filterError ? 'true' : undefined,
    },
    timestamp: new Date().toISOString(),
  });
});

// ──── GET /logs/metrics - View system metrics ────
router.get('/metrics', logsAuthMiddleware, (req, res) => {
  const metrics = getMetrics();

  res.json({
    success: true,
    data: metrics,
    timestamp: new Date().toISOString(),
  });
});

// ──── GET /logs/errors - View only error logs ────
router.get('/errors', logsAuthMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 1000);

  let allLogs = getAllLogs().filter(log => log.statusCode >= 400 || log.error);
  const total = allLogs.length;
  const errorLogs = allLogs.slice(-limit).reverse(); // Most recent first

  res.json({
    success: true,
    data: {
      total,
      limit,
      count: errorLogs.length,
      logs: errorLogs,
    },
    timestamp: new Date().toISOString(),
  });
});

// ──── GET /logs/endpoints - View endpoint statistics ────
router.get('/endpoints', logsAuthMiddleware, (req, res) => {
  const metrics = getMetrics();

  res.json({
    success: true,
    data: {
      topEndpoints: metrics.topEndpoints,
      totalEndpoints: metrics.topEndpoints.length,
    },
    timestamp: new Date().toISOString(),
  });
});

// ──── GET /logs/search - Search logs with query ────
router.get('/search', logsAuthMiddleware, (req, res) => {
  const query = req.query.q as string;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 500);

  if (!query) {
    return res.status(400).json({
      error: 'Query parameter required',
      message: 'Please provide search query: /logs/search?q=YOUR_SEARCH_TERM',
      code: 'QUERY_REQUIRED',
      statusCode: 400,
    });
  }

  const searchTerm = query.toLowerCase();
  const allLogs = getAllLogs();

  const results = allLogs
    .filter(log =>
      log.path.toLowerCase().includes(searchTerm) ||
      log.method.toLowerCase().includes(searchTerm) ||
      log.error?.toLowerCase().includes(searchTerm) ||
      (log.userId && log.userId.toLowerCase().includes(searchTerm))
    )
    .slice(-limit)
    .reverse(); // Most recent first

  res.json({
    success: true,
    data: {
      query,
      total: results.length,
      limit,
      logs: results,
    },
    timestamp: new Date().toISOString(),
  });
});

// ──── GET /logs/recent - Get most recent logs ────
router.get('/recent', logsAuthMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 500);
  const allLogs = getAllLogs();
  const recentLogs = allLogs.slice(-limit).reverse(); // Most recent first

  res.json({
    success: true,
    data: {
      limit,
      count: recentLogs.length,
      logs: recentLogs,
    },
    timestamp: new Date().toISOString(),
  });
});

export { router as logsRouter };
