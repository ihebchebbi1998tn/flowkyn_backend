/**
 * Request ID middleware — adds unique X-Request-Id header for tracing.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || uuid();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
