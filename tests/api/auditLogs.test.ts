/**
 * Audit Logs API tests
 * POST /v1/audit-logs
 * GET  /v1/audit-logs/:orgId
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

describe('Audit Logs API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /v1/audit-logs', () => {
    it('should create audit log when user is org member', async () => {
      // getMemberByUserId
      mockedQueryOne.mockResolvedValueOnce({
        id: 'member-1', organization_id: 'org-1', user_id: TEST_USER.userId,
      });
      // insert
      mockedQuery.mockResolvedValueOnce([{
        id: 'log-1', action: 'user.login', metadata: {},
      }]);

      const res = await request(app)
        .post('/v1/audit-logs')
        .set('Authorization', authHeader())
        .send({ organization_id: 'org-1', action: 'user.login', metadata: {} });

      expect(res.status).toBe(201);
    });

    it('should reject from non-org-member', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/audit-logs')
        .set('Authorization', authHeader())
        .send({ organization_id: 'org-1', action: 'user.login', metadata: {} });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /v1/audit-logs/:orgId', () => {
    it('should list audit logs for org member', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: 'member-1', organization_id: 'org-1', user_id: TEST_USER.userId,
      });
      mockedQuery.mockResolvedValueOnce([
        { id: 'log-1', action: 'event.created', user_name: 'Test' },
      ]);

      const res = await request(app)
        .get('/v1/audit-logs/org-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should reject for non-org-member', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/audit-logs/org-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(403);
    });
  });
});
