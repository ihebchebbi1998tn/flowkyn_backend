/**
 * Middleware & utility unit tests
 * - Auth middleware
 * - Error handler
 * - Validation middleware
 * - JWT utils
 * - Hash utils
 * - Slug utils
 * - Pagination utils
 */

import '../setup';
import jwt from 'jsonwebtoken';

describe('JWT Utils', () => {
  // We need to import after env is set
  let signAccessToken: any, signRefreshToken: any, verifyAccessToken: any, verifyRefreshToken: any;

  beforeAll(async () => {
    const mod = await import('../../src/utils/jwt');
    signAccessToken = mod.signAccessToken;
    signRefreshToken = mod.signRefreshToken;
    verifyAccessToken = mod.verifyAccessToken;
    verifyRefreshToken = mod.verifyRefreshToken;
  });

  it('should sign and verify access token', () => {
    const payload = { userId: 'user-1', email: 'test@test.com' };
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);

    expect(decoded.userId).toBe('user-1');
    expect(decoded.email).toBe('test@test.com');
  });

  it('should sign and verify refresh token', () => {
    const payload = { userId: 'user-1', email: 'test@test.com' };
    const token = signRefreshToken(payload);
    const decoded = verifyRefreshToken(token);

    expect(decoded.userId).toBe('user-1');
  });

  it('should reject tampered token', () => {
    const token = signAccessToken({ userId: 'u1', email: 'a@b.com' });
    expect(() => verifyAccessToken(token + 'tampered')).toThrow();
  });

  it('should reject access token verified as refresh', () => {
    const token = signAccessToken({ userId: 'u1', email: 'a@b.com' });
    expect(() => verifyRefreshToken(token)).toThrow();
  });
});

describe('Hash Utils', () => {
  let hashPassword: any, comparePassword: any;

  beforeAll(async () => {
    const mod = await import('../../src/utils/hash');
    hashPassword = mod.hashPassword;
    comparePassword = mod.comparePassword;
  });

  it('should hash and compare passwords', async () => {
    const hash = await hashPassword('TestPass123');
    expect(hash).not.toBe('TestPass123');

    const valid = await comparePassword('TestPass123', hash);
    expect(valid).toBe(true);

    const invalid = await comparePassword('WrongPass', hash);
    expect(invalid).toBe(false);
  });

  it('should produce different hashes for same password', async () => {
    const hash1 = await hashPassword('Same123');
    const hash2 = await hashPassword('Same123');
    expect(hash1).not.toBe(hash2); // bcrypt salts are random
  });
});

describe('Slug Utils', () => {
  let generateSlug: any;

  beforeAll(async () => {
    const mod = await import('../../src/utils/slug');
    generateSlug = mod.generateSlug;
  });

  it('should generate a valid slug', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('should handle special characters', () => {
    const slug = generateSlug('Café & Restaurant!');
    expect(slug).not.toContain('&');
    expect(slug).not.toContain('!');
  });

  it('should handle multiple spaces', () => {
    const slug = generateSlug('  lots   of   spaces  ');
    expect(slug).not.toContain('  ');
  });
});

describe('Pagination Utils', () => {
  let parsePagination: any, buildPaginatedResponse: any;

  beforeAll(async () => {
    const mod = await import('../../src/utils/pagination');
    parsePagination = mod.parsePagination;
    buildPaginatedResponse = mod.buildPaginatedResponse;
  });

  it('should parse default pagination', () => {
    const result = parsePagination({});
    expect(result.page).toBe(1);
    expect(result.limit).toBeGreaterThan(0);
    expect(result.offset).toBe(0);
  });

  it('should parse custom pagination', () => {
    const result = parsePagination({ page: 3, limit: 10 });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
  });

  it('should build paginated response', () => {
    const data = [{ id: '1' }, { id: '2' }];
    const response = buildPaginatedResponse(data, 25, 1, 10);

    expect(response.data).toHaveLength(2);
    expect(response.pagination.total).toBe(25);
    expect(response.pagination.totalPages).toBe(3);
    expect(response.pagination.page).toBe(1);
    expect(response.pagination.limit).toBe(10);
  });
});

describe('Error Handler', () => {
  let AppError: any;

  beforeAll(async () => {
    const mod = await import('../../src/middleware/errorHandler');
    AppError = mod.AppError;
  });

  it('should create AppError with status code', () => {
    const err = new AppError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
  });

  it('should default to 500', () => {
    const err = new AppError('Server error');
    expect(err.statusCode).toBe(500);
  });
});

describe('Auth Middleware', () => {
  jest.mock('../../src/config/database', () => require('../mocks/database'));

  it('should reject missing authorization header', async () => {
    const { authenticate } = await import('../../src/middleware/auth');
    const req: any = { headers: {} };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject invalid token', async () => {
    const { authenticate } = await import('../../src/middleware/auth');
    const req: any = { headers: { authorization: 'Bearer invalid-token' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should pass with valid token', async () => {
    const { authenticate } = await import('../../src/middleware/auth');
    const { signAccessToken } = await import('../../src/utils/jwt');
    const token = signAccessToken({ userId: 'u1', email: 'a@b.com' });

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('u1');
  });
});

describe('Validation Middleware', () => {
  it('should validate and transform body', async () => {
    const { validate } = await import('../../src/middleware/validate');
    const { z } = await import('zod');

    const schema = z.object({ name: z.string().min(1) });
    const middleware = validate(schema);

    const req: any = { body: { name: 'Test' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Test');
  });

  it('should reject invalid body', async () => {
    const { validate } = await import('../../src/middleware/validate');
    const { z } = await import('zod');

    const schema = z.object({ name: z.string().min(1) });
    const middleware = validate(schema);

    const req: any = { body: {} };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
