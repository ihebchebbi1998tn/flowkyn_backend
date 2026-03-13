/**
 * Express middleware — captures request/response details into the monitor store.
 * Improved version with better reliability and skip pattern.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { addLog, RequestLog } from './store';

// Routes to skip monitoring
const SKIP_PATHS = ['/monitor', '/health', '/metrics', '/docs', '/docs.json', '/uploads'];

let logCount = 0;

console.log('[Monitor] Middleware initialized. Tracking API requests...');

export function monitorMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip monitor routes and static files
  if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

  const startTime = Date.now();
  const logId = uuid();

  // Capture request body (truncate large payloads)
  let reqBody: unknown = undefined;
  if (req.body && Object.keys(req.body).length > 0) {
    try {
      const str = JSON.stringify(req.body);
      reqBody = str.length > 2000 ? JSON.parse(str.substring(0, 2000) + '..."') : req.body;
      // Redact sensitive fields
      if (typeof reqBody === 'object' && reqBody !== null) {
        const redacted = { ...(reqBody as Record<string, unknown>) };
        for (const key of ['password', 'token', 'refresh_token', 'access_token', 'secret', 'pass']) {
          if (key in redacted) redacted[key] = '***REDACTED***';
        }
        reqBody = redacted;
      }
    } catch (e) {
      // Silently ignore JSON stringification errors
    }
  }

  // Intercept response.json()
  const originalJson = res.json.bind(res);
  let resBody: unknown = undefined;
  let responseLogged = false;

  res.json = function (body: unknown) {
    resBody = body;
    // Log immediately to ensure capture
    logRequest(res.statusCode);
    return originalJson(body);
  };

  // Fallback: use 'finish' event for non-json responses
  res.on('finish', () => {
    if (!responseLogged) {
      logRequest(res.statusCode);
    }
  });

  // Ensure logging happens even on error
  res.on('error', () => {
    if (!responseLogged) {
      logRequest(res.statusCode || 500);
    }
  });

  function logRequest(statusCode: number) {
    if (responseLogged) return;
    responseLogged = true;

    const duration = Date.now() - startTime;
    const tags: string[] = [];

    if (statusCode >= 500) tags.push('error', 'server-error');
    else if (statusCode >= 400) tags.push('error', 'client-error');
    if (duration > 1000) tags.push('slow');
    if (duration > 3000) tags.push('very-slow');
    if (req.path.includes('/auth')) tags.push('auth');
    if (req.path.includes('/admin')) tags.push('admin');
    if (req.method !== 'GET') tags.push('mutation');

    // Extract userId from JWT payload if present
    const userId = (req as any).user?.userId;

    const log: RequestLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      duration,
      ip: (req.ip || req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || '').replace('::ffff:', ''),
      userAgent: (req.headers['user-agent'] || '').substring(0, 200),
      userId,
      requestBody: reqBody,
      responseBody: statusCode >= 400 ? resBody : undefined, // Only capture error responses
      error: statusCode >= 400 && typeof resBody === 'object' && resBody !== null
        ? (resBody as any).error || (resBody as any).message || (resBody as any).statusMessage
        : undefined,
      tags,
    };

    try {
      addLog(log);
      logCount++;
      if (logCount % 50 === 0) {
        console.log(`[Monitor] Captured ${logCount} requests`);
      }
    } catch (e) {
      console.error('[Monitor] Error adding log:', e);
    }
  }

  next();
}
