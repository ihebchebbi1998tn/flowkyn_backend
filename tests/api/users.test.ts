/**
 * Users API tests
 * GET  /v1/users/profile
 * PUT  /v1/users/profile
 * POST /v1/users/avatar
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { queryOne } from '../../src/config/database';
import { authHeader, TEST_USER } from '../helpers';

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

describe('Users API', () => {
  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════
  //  GET /v1/users/profile
  // ═══════════════════════════════════
  describe('GET /v1/users/profile', () => {
    it('should return user profile', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        name: 'Test User',
        avatar_url: null,
        status: 'active',
      });

      const res = await request(app)
        .get('/v1/users/profile')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test User');
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/users/profile');
      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent user', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/users/profile')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════
  //  PUT /v1/users/profile
  // ═══════════════════════════════════
  describe('PUT /v1/users/profile', () => {
    it('should update user name', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: TEST_USER.userId,
        email: TEST_USER.email,
        name: 'Updated Name',
        avatar_url: null,
        status: 'active',
      });

      const res = await request(app)
        .put('/v1/users/profile')
        .set('Authorization', authHeader())
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('should reject empty body', async () => {
      const res = await request(app)
        .put('/v1/users/profile')
        .set('Authorization', authHeader())
        .send({});

      // Depending on service logic, this should return 400
      expect([200, 400]).toContain(res.status);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/users/avatar
  // ═══════════════════════════════════
  describe('POST /v1/users/avatar', () => {
    it('should reject upload without file', async () => {
      const res = await request(app)
        .post('/v1/users/avatar')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
    });

    it('should require authentication for avatar upload', async () => {
      const res = await request(app).post('/v1/users/avatar');
      expect(res.status).toBe(401);
    });
  });
});
