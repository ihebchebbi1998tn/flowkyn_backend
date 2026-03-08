/**
 * Auth API tests
 * POST /v1/auth/register
 * POST /v1/auth/login
 * POST /v1/auth/verify-email
 * POST /v1/auth/refresh
 * POST /v1/auth/logout
 * GET  /v1/auth/me
 * POST /v1/auth/forgot-password
 * POST /v1/auth/reset-password
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../../tests/setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne, transaction } from '../../src/config/database';
import { sendEmail } from '../../src/services/email.service';
import { authHeader, generateAccessToken, generateRefreshToken, TEST_USER } from '../helpers';
import { hashPassword } from '../../src/utils/hash';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

describe('Auth API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/register
  // ═══════════════════════════════════
  describe('POST /v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'new@flowkyn.com', password: 'Test1234', name: 'New User' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Verification email sent');
      expect(mockedSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'new@flowkyn.com', type: 'verify_account' })
      );
    });

    it('should reject registration with weak password', async () => {
      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'new@flowkyn.com', password: 'weak', name: 'User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('should reject registration with missing fields', async () => {
      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'test@flowkyn.com' });

      expect(res.status).toBe(400);
    });

    it('should reject registration with invalid email', async () => {
      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'not-an-email', password: 'Test1234', name: 'User' });

      expect(res.status).toBe(400);
    });

    it('should handle duplicate email (rowCount=0)', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'existing@flowkyn.com', password: 'Test1234', name: 'User' });

      expect(res.status).toBe(409);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/login
  // ═══════════════════════════════════
  describe('POST /v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const hash = await hashPassword('Test1234');
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        password_hash: hash,
        status: 'active',
        name: 'Test',
      });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: TEST_USER.email, password: 'Test1234' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
    });

    it('should reject invalid credentials', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'wrong@flowkyn.com', password: 'Wrong1234' });

      expect(res.status).toBe(401);
    });

    it('should reject suspended accounts', async () => {
      const hash = await hashPassword('Test1234');
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        password_hash: hash,
        status: 'suspended',
      });

      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: TEST_USER.email, password: 'Test1234' });

      expect(res.status).toBe(403);
    });

    it('should reject unverified accounts', async () => {
      const hash = await hashPassword('Test1234');
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        password_hash: hash,
        status: 'pending',
      });

      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: TEST_USER.email, password: 'Test1234' });

      expect(res.status).toBe(403);
    });

    it('should reject with wrong password', async () => {
      const hash = await hashPassword('CorrectPass1');
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        password_hash: hash,
        status: 'active',
      });

      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: TEST_USER.email, password: 'WrongPass1' });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/verify-email
  // ═══════════════════════════════════
  describe('POST /v1/auth/verify-email', () => {
    it('should verify email with valid token', async () => {
      mockedQueryOne.mockResolvedValueOnce({ user_id: TEST_USER.userId });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/auth/verify-email')
        .send({ token: 'valid-token-123' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Email verified successfully');
    });

    it('should reject invalid verification token', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/auth/verify-email')
        .send({ token: 'invalid-token' });

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/refresh
  // ═══════════════════════════════════
  describe('POST /v1/auth/refresh', () => {
    it('should return new access token with valid refresh token', async () => {
      const refreshToken = generateRefreshToken();
      mockedQueryOne.mockResolvedValueOnce({
        id: 'session-1',
        user_id: TEST_USER.userId,
        refresh_token: 'hashed',
        expires_at: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refresh_token: refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
    });

    it('should reject expired/invalid refresh token', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refresh_token: 'totally-invalid-token' });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/logout
  // ═══════════════════════════════════
  describe('POST /v1/auth/logout', () => {
    it('should logout authenticated user', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');
    });

    it('should reject unauthenticated logout', async () => {
      const res = await request(app).post('/v1/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/auth/me
  // ═══════════════════════════════════
  describe('GET /v1/auth/me', () => {
    it('should return current user profile', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        name: 'Test User',
        avatar_url: null,
        status: 'active',
      });

      const res = await request(app)
        .get('/v1/auth/me')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(TEST_USER.email);
    });

    it('should reject without auth header', async () => {
      const res = await request(app).get('/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/forgot-password
  // ═══════════════════════════════════
  describe('POST /v1/auth/forgot-password', () => {
    it('should send reset email for existing user', async () => {
      mockedQueryOne.mockResolvedValueOnce({ id: TEST_USER.userId });
      mockedQuery.mockResolvedValueOnce([]); // delete existing tokens
      mockedQuery.mockResolvedValueOnce([]); // insert new token

      const res = await request(app)
        .post('/v1/auth/forgot-password')
        .send({ email: TEST_USER.email });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('If the email exists');
    });

    it('should return same message for non-existing email (no enumeration)', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/auth/forgot-password')
        .send({ email: 'nonexistent@flowkyn.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('If the email exists');
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/auth/reset-password
  // ═══════════════════════════════════
  describe('POST /v1/auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      mockedQueryOne.mockResolvedValueOnce({ email: TEST_USER.email });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: 'valid-reset-token', password: 'NewPass123' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password reset successfully');
    });

    it('should reject invalid/expired reset token', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: 'expired-token', password: 'NewPass123' });

      expect(res.status).toBe(400);
    });
  });
});
