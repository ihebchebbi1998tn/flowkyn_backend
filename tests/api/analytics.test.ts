/**
 * Analytics API tests
 * POST /v1/analytics/track
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query } from '../../src/config/database';
import { authHeader, TEST_USER } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('Analytics API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /v1/analytics/track', () => {
    it('should track analytics event', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'ae-1', user_id: TEST_USER.userId, event_name: 'page_view', properties: { page: '/home' },
      }]);

      const res = await request(app)
        .post('/v1/analytics/track')
        .set('Authorization', authHeader())
        .send({ event_name: 'page_view', properties: { page: '/home' } });

      expect(res.status).toBe(201);
      expect(res.body.event_name).toBe('page_view');
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/v1/analytics/track')
        .send({ event_name: 'page_view', properties: {} });

      expect(res.status).toBe(401);
    });
  });
});
