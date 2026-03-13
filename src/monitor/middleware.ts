/**
 * Express middleware — captures COMPLETE request/response details into the monitor store.
 * Logs everything: query params, headers, body, response, timing, etc.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { addLog, RequestLog } from './store';

// Routes to skip monitoring
const SKIP_PATHS = ['/monitor', '/health', '/metrics', '/docs', '/docs.json', '/uploads'];

let logCount = 0;

console.log('[Monitor] Middleware initialized. Tracking ALL API requests with complete details...');

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
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
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
        for (const key of ['password', 'token', 'refresh_token', 'access_token', 'secret', 'pass', 'pin']) {
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

      // COMPREHENSIVE CONSOLE LOGGING
      const logPrefix = `[API ${log.method}]`;
      const statusColor = statusCode >= 500 ? '❌' : statusCode >= 400 ? '⚠️' : statusCode === 200 ? '✅' : '📘';
      
      console.log(
        `${statusColor} ${logPrefix} ${log.path} → ${statusCode} (${duration}ms)`,
        `[ID: ${logId}]`
      );

      // Log query params if present
      if (Object.keys(queryParams).length > 0) {
        console.log(`   📥 Query Params:`, queryParams);
      }

      // Log request body if present
      if (reqBody) {
        console.log(`   📤 Request Body:`, reqBody);
      }

      // Log response (first 1000 chars for console readability)
      if (resBody && (statusCode >= 400 || statusCode === 200)) {
        const resStr = typeof resBody === 'string' ? resBody : JSON.stringify(resBody);
        const truncated = resStr.length > 1000 ? resStr.substring(0, 1000) + '...' : resStr;
        console.log(`   📬 Response Body:`, truncated);
      }

      // Log userId if authenticated
      if (userId) {
        console.log(`   👤 User ID:`, userId);
      }

      // Log errors in detail
      if (statusCode >= 400) {
        const errorMsg = log.error || 'Unknown error';
        console.log(`   ❌ Error:`, errorMsg);
        if (typeof resBody === 'object' && resBody !== null) {
          console.log(`   📋 Full Error Response:`, resBody);
        }
      }

      // Report every 50 requests
      if (logCount % 50 === 0) {
        console.log(`\n[Monitor] ✅ Total captured: ${logCount} requests\n`);
      }
    } catch (e) {
      console.error('[Monitor] Error adding log:', e);
    }
  }

  next();
}
