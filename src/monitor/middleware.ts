/**
 * Express middleware — captures request/response details into the monitor store.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { addLog, RequestLog } from './store';

export function monitorMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip monitor routes themselves
  if (req.path.startsWith('/monitor')) return next();

  const startTime = Date.now();
  const logId = uuid();

  // Capture request body (truncate large payloads)
  let reqBody: unknown = undefined;
  if (req.body && Object.keys(req.body).length > 0) {
    const str = JSON.stringify(req.body);
    reqBody = str.length > 2000 ? JSON.parse(str.substring(0, 2000) + '..."') : req.body;
    // Redact sensitive fields
    if (typeof reqBody === 'object' && reqBody !== null) {
      const redacted = { ...(reqBody as Record<string, unknown>) };
      for (const key of ['password', 'token', 'refresh_token', 'access_token', 'secret']) {
        if (key in redacted) redacted[key] = '***REDACTED***';
      }
      reqBody = redacted;
    }
  }

  // Intercept response
  const originalJson = res.json.bind(res);
  let resBody: unknown = undefined;

  res.json = function (body: unknown) {
    resBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const tags: string[] = [];

    if (res.statusCode >= 500) tags.push('error', 'server-error');
    else if (res.statusCode >= 400) tags.push('error', 'client-error');
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
      statusCode: res.statusCode,
      duration,
      ip: (req.ip || req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || '').replace('::ffff:', ''),
      userAgent: (req.headers['user-agent'] || '').substring(0, 200),
      userId,
      requestBody: reqBody,
      responseBody: res.statusCode >= 400 ? resBody : undefined, // Only capture error responses
      error: res.statusCode >= 400 && typeof resBody === 'object' && resBody !== null
        ? (resBody as any).error || (resBody as any).message
        : undefined,
      tags,
    };

    addLog(log);
  });

  next();
}
