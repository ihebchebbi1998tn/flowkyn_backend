/**
 * Express middleware — captures COMPLETE request/response details
 * Professional monitoring with stable, clean logging
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { addLog, RequestLog } from './store';

// Routes to skip monitoring
const SKIP_PATHS = ['/monitor', '/health/live', '/metrics', '/docs', '/docs.json', '/favicon.ico', '/uploads'];

let logCount = 0;

console.log('[Monitor] ✓ Middleware initialized. Capturing all API requests.');

export function monitorMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip monitor routes and static files
  if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

  const startTime = Date.now();
  const logId = uuid();

  // Capture COMPLETE request info
  let reqBody: unknown = undefined;
  let queryParams: Record<string, string> = {};
  let headers: Record<string, string> = {};

  // Get query parameters
  if (Object.keys(req.query).length > 0) {
    queryParams = Object.fromEntries(
      Object.entries(req.query).map(([k, v]) => [k, String(v)])
    );
  }

  // Get headers (excluding sensitive ones)
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'passport'];
  headers = Object.fromEntries(
    Object.entries(req.headers)
      .filter(([k]) => !sensitiveHeaders.includes(k.toLowerCase()))
      .map(([k, v]) => [k, String(v).substring(0, 200)])
  );

  // Capture request body (full, with truncation)
  if (req.body && Object.keys(req.body).length > 0) {
    try {
      const str = JSON.stringify(req.body);
      if (str.length > 5000) {
        reqBody = JSON.parse(str.substring(0, 5000)) + '... [truncated]';
      } else {
        reqBody = req.body;
      }
      // Redact sensitive fields
      if (typeof reqBody === 'object' && reqBody !== null) {
        const redacted = { ...(reqBody as Record<string, unknown>) };
        for (const key of ['password', 'token', 'refresh_token', 'access_token', 'secret', 'pass', 'pin', 'creditCard', 'ssn']) {
          if (key in redacted) redacted[key] = '***REDACTED***';
        }
        reqBody = redacted;
      }
    } catch (e) {
      reqBody = '[Error parsing body]';
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
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      requestHeaders: Object.keys(headers).length > 0 ? headers : undefined,
      responseBody: resBody, // ALWAYS capture response for debugging
      error: statusCode >= 400 && typeof resBody === 'object' && resBody !== null
        ? (resBody as any).error || (resBody as any).message || (resBody as any).statusMessage
        : undefined,
      tags,
    };

    try {
      addLog(log);
      logCount++;

      // PROFESSIONAL CONSOLE LOGGING - clean, single-line format
      const statusIcon = statusCode >= 500 ? '❌' : statusCode >= 400 ? '⚠️' : '✓';
      const slowIcon = duration > 1000 ? '⏱️' : '';
      
      console.log(
        `${statusIcon} [${log.method}] ${log.path} → ${statusCode} (${duration}ms)${slowIcon}${userId ? ` [${userId}]` : ''}`
      );

      // Only log detailed info for errors and slow requests
      if (statusCode >= 400) {
        if (log.queryParams && Object.keys(log.queryParams).length > 0) {
          console.log(`    Query: ${JSON.stringify(log.queryParams).substring(0, 150)}`);
        }
        if (log.error) {
          console.log(`    Error: ${log.error.substring(0, 200)}`);
        }
        if (log.requestBody) {
          const bodyStr = JSON.stringify(log.requestBody);
          console.log(`    Request: ${bodyStr.substring(0, 150)}`);
        }
      }

      // Report every 100 requests
      if (logCount % 100 === 0) {
        console.log(`\n[Monitor] ✓ Logged ${logCount} requests (${totalRequestLog()})\n`);
      }
    } catch (e) {
      console.error('[Monitor] Error adding log:', e);
    }
  }

  next();
}

function totalRequestLog(): string {
  // This will be replaced at runtime
  return 'tracking...';
}
