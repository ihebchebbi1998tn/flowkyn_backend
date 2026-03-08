import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.headers['x-request-id'] || 'unknown';

  // Multer file size error
  if (err.message?.includes('File too large') || (err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large', requestId });
    return;
  }

  // Multer file type error
  if (err.message?.includes('Only image files') || err.message?.includes('not allowed')) {
    res.status(400).json({ error: err.message, requestId });
    return;
  }

  // CORS error
  if (err.message?.includes('Not allowed by CORS')) {
    res.status(403).json({ error: 'Origin not allowed', requestId });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, requestId });
    return;
  }

  // PostgreSQL unique constraint violation
  if ((err as any).code === '23505') {
    res.status(409).json({ error: 'Resource already exists', requestId });
    return;
  }

  // PostgreSQL foreign key violation
  if ((err as any).code === '23503') {
    res.status(400).json({ error: 'Referenced resource not found', requestId });
    return;
  }

  // PostgreSQL query timeout
  if ((err as any).code === '57014') {
    console.error(`[${requestId}] Query timeout:`, err.message);
    res.status(504).json({ error: 'Request timed out', requestId });
    return;
  }

  // Connection pool exhaustion
  if (err.message?.includes('timeout exceeded') || err.message?.includes('Connection terminated')) {
    console.error(`[${requestId}] Database connection error:`, err.message);
    res.status(503).json({ error: 'Service temporarily unavailable', requestId });
    return;
  }

  // Don't leak internal error details in production
  console.error(`[${requestId}] Unhandled error:`, err);
  res.status(500).json({ error: 'Internal server error', requestId });
}
