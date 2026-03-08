import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const requestId = (req.headers['x-request-id'] as string) || 'unknown';
        const details = err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        // Build a human-readable summary from the first few errors
        const summary = details.slice(0, 3).map(d => `${d.field}: ${d.message}`).join('; ');
        res.status(400).json({
          error: `Validation failed — ${summary}`,
          code: 'VALIDATION_FAILED',
          statusCode: 400,
          requestId,
          details,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    }
  };
}
