/**
 * Leaderboards API tests
 * GET /v1/leaderboards/:id
 * GET /v1/leaderboards/:id/entries
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/config/database';
import { authHeader } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

describe('Leaderboards API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/leaderboards/:id', () => {
    it('should return leaderboard', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: 'lb-1', game_type_id: 'gt-1', organization_id: 'org-1', season: 'Q1-2026',
      });

      const res = await request(app)
        .get('/v1/leaderboards/lb-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('lb-1');
    });

    it('should return 404 for non-existent leaderboard', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/leaderboards/nonexistent')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/leaderboards/:id/entries', () => {
    it('should return leaderboard entries', async () => {
      mockedQuery.mockResolvedValueOnce([
        { id: 'le-1', participant_id: 'p-1', score: 100, rank: 1, user_name: 'Winner' },
        { id: 'le-2', participant_id: 'p-2', score: 80, rank: 2, user_name: 'Runner Up' },
      ]);

      const res = await request(app)
        .get('/v1/leaderboards/lb-1/entries')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].rank).toBe(1);
    });
  });
});
