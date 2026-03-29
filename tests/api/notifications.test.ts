/**
 * Notifications API tests
 * GET  /v1/notifications
 * PUT  /v1/notifications/:id/read
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/config/database';
import { authHeader, TEST_USER } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

describe('Notifications API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/notifications', () => {
    it('should list notifications for user', async () => {
      mockedQuery
        .mockResolvedValueOnce([
          { id: 'n-1', user_id: TEST_USER.userId, type: 'event_invite', data: {}, read_at: null },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      const res = await request(app)
        .get('/v1/notifications')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveLength(1);
    });

    it('should return empty list', async () => {
      mockedQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '0' }]);

      const res = await request(app)
        .get('/v1/notifications')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /v1/notifications/:id/read', () => {
    it('should mark notification as read', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: 'n-1', user_id: TEST_USER.userId, type: 'event_invite', read_at: new Date(),
      });

      const res = await request(app)
        .put('/v1/notifications/n-1/read')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
    });
  });
});
