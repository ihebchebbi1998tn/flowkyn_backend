import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Standardized error codes for the entire API.
 * Frontend can switch on `code` for i18n or custom handling.
 */
export type ErrorCode =
  // Auth
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_INVALID_PASSWORD'
  | 'AUTH_ACCOUNT_SUSPENDED'
  | 'AUTH_ACCOUNT_NOT_VERIFIED'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_MISSING_TOKEN'
  | 'AUTH_EMAIL_IN_USE'
  | 'AUTH_ALREADY_VERIFIED'
  | 'AUTH_VERIFICATION_EXPIRED'
  | 'AUTH_RESET_TOKEN_EXPIRED'
  // Authorization
  | 'FORBIDDEN'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'NOT_A_MEMBER'
  | 'SOLE_OWNER'
  | 'SUPER_ADMIN_REQUIRED'
  // Validation
  | 'VALIDATION_FAILED'
  | 'MISSING_FIELD'
  | 'INVALID_FORMAT'
  // Resources
  | 'NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'REFERENCED_NOT_FOUND'
  // Rate limiting
  | 'RATE_LIMITED'
  // Files
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_MISSING'
  // Events / Games
  | 'EVENT_FULL'
  | 'ALREADY_PARTICIPANT'
  | 'NOT_PARTICIPANT'
  | 'SESSION_NOT_ACTIVE'
  | 'ROUND_NOT_ACTIVE'
  | 'SESSION_ALREADY_FINISHED'
  // Infrastructure
  | 'CORS_BLOCKED'
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Structured error response — consistent shape for all API errors.
 * Frontend uses: error/message (display text), code (for i18n), details (field-level).
 */
export interface ErrorResponse {
  error: string;
  message: string; // Alias for frontend display
  code: ErrorCode;
  statusCode: number;
  requestId: string;
  details?: { field: string; message: string }[];
  timestamp: string;
}

/**
 * Application error with structured code and optional field-level details.
 */
export class AppError extends Error {
  public statusCode: number;
  public code: ErrorCode;
  public isOperational: boolean;
  public details?: { field: string; message: string }[];

  constructor(message: string, statusCode: number = 500, code?: ErrorCode, details?: { field: string; message: string }[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || statusCodeToErrorCode(statusCode);
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Map HTTP status codes to default error codes */
function statusCodeToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400: return 'VALIDATION_FAILED';
    case 401: return 'AUTH_TOKEN_INVALID';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'ALREADY_EXISTS';
    case 413: return 'FILE_TOO_LARGE';
    case 429: return 'RATE_LIMITED';
    case 503: return 'SERVICE_UNAVAILABLE';
    case 504: return 'TIMEOUT';
    default: return 'INTERNAL_ERROR';
  }
}

/** Build a consistent error response object for frontend consumption */
function buildErrorResponse(
  statusCode: number,
  error: string,
  code: ErrorCode,
  requestId: string,
  details?: { field: string; message: string }[]
): ErrorResponse {
  return {
    error,
    message: error,
    code,
    statusCode,
    requestId,
    ...(details && details.length > 0 ? { details } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Global error handler — catches all errors and returns structured responses.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';

  // ─── Multer file size error ───
  if (err.message?.includes('File too large') || (err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json(buildErrorResponse(413, 'File exceeds maximum allowed size (5MB for logos). Please choose a smaller image.', 'FILE_TOO_LARGE', requestId, [
      { field: 'logo', message: 'Maximum file size is 5MB' },
    ]));
    return;
  }

  // ─── Multer no file / missing field ───
  if (err.message?.includes('No file') || (err as any).code === 'LIMIT_UNEXPECTED_FILE' || err.message?.includes('Unexpected field')) {
    res.status(400).json(buildErrorResponse(400, 'No file was uploaded. Please select an image (JPEG, PNG, GIF, or WebP).', 'FILE_MISSING', requestId, [
      { field: 'logo', message: 'A logo file is required' },
    ]));
    return;
  }

  // ─── Multer file type error ───
  if (err.message?.includes('Only image files') || err.message?.includes('not allowed') || err.message?.includes('file type')) {
    res.status(400).json(buildErrorResponse(400, 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.', 'FILE_TYPE_NOT_ALLOWED', requestId, [
      { field: 'logo', message: 'Accepted formats: JPEG, PNG, GIF, WebP' },
    ]));
    return;
  }

  // ─── CORS error (should not occur with allow-all config) ───
  if (err.message?.includes('Not allowed by CORS')) {
    res.status(403).json(buildErrorResponse(403, 'Request blocked by CORS policy. Please check that the API allows your origin.', 'CORS_BLOCKED', requestId));
    return;
  }

  // ─── Application errors (thrown intentionally) ───
  if (err instanceof AppError) {
    if (!err.isOperational) {
      console.error(`[${requestId}] Non-operational AppError:`, err);
    }
    res.status(err.statusCode).json(buildErrorResponse(err.statusCode, err.message, err.code, requestId, err.details));
    return;
  }

  // ─── PostgreSQL invalid UUID syntax ───
  if (err.message?.includes('invalid input syntax for type uuid')) {
    res.status(400).json(buildErrorResponse(400, 'Invalid ID format — expected a valid UUID', 'INVALID_FORMAT', requestId, [
      { field: 'id', message: 'Must be a valid UUID' },
    ]));
    return;
  }

  // ─── PostgreSQL unique constraint violation ───
  if ((err as any).code === '23505') {
    const detail = (err as any).detail || '';
    // Extract the conflicting field name from PG detail message
    const fieldMatch = detail.match(/\(([^)]+)\)/);
    const field = fieldMatch ? fieldMatch[1] : 'unknown';
    res.status(409).json(buildErrorResponse(409, `A record with this ${field} already exists`, 'ALREADY_EXISTS', requestId, [
      { field, message: `Value already in use` },
    ]));
    return;
  }

  // ─── PostgreSQL foreign key violation ───
  if ((err as any).code === '23503') {
    const detail = (err as any).detail || '';
    const tableMatch = detail.match(/table "([^"]+)"/);
    const refTable = tableMatch ? tableMatch[1] : 'resource';
    res.status(400).json(buildErrorResponse(400, `Referenced ${refTable} not found`, 'REFERENCED_NOT_FOUND', requestId));
    return;
  }

  // ─── PostgreSQL not-null violation ───
  if ((err as any).code === '23502') {
    const column = (err as any).column || 'unknown';
    res.status(400).json(buildErrorResponse(400, `Missing required field: ${column}`, 'MISSING_FIELD', requestId, [
      { field: column, message: 'This field is required' },
    ]));
    return;
  }

  // ─── PostgreSQL check constraint violation ───
  if ((err as any).code === '23514') {
    res.status(400).json(buildErrorResponse(400, 'Value does not meet constraints', 'VALIDATION_FAILED', requestId));
    return;
  }

  // ─── PostgreSQL query timeout ───
  if ((err as any).code === '57014') {
    console.error(`[${requestId}] Query timeout:`, err.message);
    res.status(504).json(buildErrorResponse(504, 'Request timed out — please try again', 'TIMEOUT', requestId));
    return;
  }

  // ─── Connection pool exhaustion / DB connection errors ───
  if (err.message?.includes('timeout exceeded') || err.message?.includes('Connection terminated')) {
    console.error(`[${requestId}] Database connection error:`, err.message);
    res.status(503).json(buildErrorResponse(503, 'Service temporarily unavailable. Please try again in a few moments.', 'SERVICE_UNAVAILABLE', requestId));
    return;
  }

  // ─── ECONNREFUSED / ENOTFOUND (e.g. DB unreachable) ───
  if ((err as any).code === 'ECONNREFUSED' || (err as any).code === 'ENOTFOUND') {
    console.error(`[${requestId}] Connection error:`, err.message);
    res.status(503).json(buildErrorResponse(503, 'Unable to reach the service. Please try again later.', 'SERVICE_UNAVAILABLE', requestId));
    return;
  }

  // ─── JWT errors (from jsonwebtoken library) ───
  if (err.name === 'TokenExpiredError') {
    res.status(401).json(buildErrorResponse(401, 'Your session has expired. Please sign in again.', 'AUTH_TOKEN_EXPIRED', requestId));
    return;
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    res.status(401).json(buildErrorResponse(401, 'Invalid or missing authentication. Please sign in again.', 'AUTH_TOKEN_INVALID', requestId));
    return;
  }

  // ─── SyntaxError from malformed JSON body ───
  if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
    res.status(400).json(buildErrorResponse(400, 'Malformed JSON in request body', 'VALIDATION_FAILED', requestId));
    return;
  }

  // ─── Fallback — never leak internal details in production ───
  console.error(`[${requestId}] Unhandled error:`, err);
  const userMessage = env.nodeEnv === 'development'
    ? `An unexpected error occurred: ${err.message}`
    : 'An unexpected error occurred. Please try again. If the problem persists, contact support.';
  res.status(500).json(buildErrorResponse(500, userMessage, 'INTERNAL_ERROR', requestId));
}
