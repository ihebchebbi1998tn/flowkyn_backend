/**
 * Health check & app-level tests
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { checkConnection } from '../../src/config/database';

const mockedCheckConnection = checkConnection as jest.MockedFunction<typeof checkConnection>;

describe('App-level', () => {
  describe('GET /health', () => {
    it('should return 200 when DB is connected', async () => {
      mockedCheckConnection.mockResolvedValueOnce(true);

      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
    });

    it('should return 503 when DB is unreachable', async () => {
      mockedCheckConnection.mockResolvedValueOnce(false);

      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
    });
  });

  describe('404 handler', () => {
    it('should return 404 JSON for unknown routes', async () => {
      const res = await request(app).get('/v1/nonexistent-route');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
