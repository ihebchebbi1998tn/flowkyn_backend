/**
 * Games API tests
 * GET  /v1/game-types
 * POST /v1/events/:eventId/game-sessions
 * POST /v1/game-sessions/:id/rounds
 * POST /v1/game-sessions/actions
 * POST /v1/game-sessions/:id/finish
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne, transaction } from '../../src/config/database';
import { authHeader } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;

describe('Games API', () => {
  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════
  //  GET /v1/game-types
  // ═══════════════════════════════════
  describe('GET /v1/game-types', () => {
    it('should list all game types', async () => {
      mockedQuery.mockResolvedValueOnce([
        { id: 'gt-1', key: 'trivia', name: 'Trivia', category: 'quiz' },
        { id: 'gt-2', key: 'word-chain', name: 'Word Chain', category: 'word' },
      ]);

      const res = await request(app)
        .get('/v1/game-types')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/events/:eventId/game-sessions
  // ═══════════════════════════════════
  describe('POST /v1/events/:eventId/game-sessions', () => {
    it('should start game session for active event', async () => {
      mockedQueryOne
        .mockResolvedValueOnce({ id: 'event-1', status: 'active' }) // event
        .mockResolvedValueOnce({ id: 'gt-1' }); // game type
      mockedQuery.mockResolvedValueOnce([{
        id: 'gs-1', event_id: 'event-1', game_type_id: 'gt-1', status: 'active', current_round: 0,
      }]);

      const res = await request(app)
        .post('/v1/events/event-1/game-sessions')
        .set('Authorization', authHeader())
        .send({ game_type_id: 'gt-1' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');
    });

    it('should reject for non-active event', async () => {
      mockedQueryOne.mockResolvedValueOnce({ id: 'event-1', status: 'draft' });

      const res = await request(app)
        .post('/v1/events/event-1/game-sessions')
        .set('Authorization', authHeader())
        .send({ game_type_id: 'gt-1' });

      expect(res.status).toBe(400);
    });

    it('should reject for non-existent event', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/events/nonexistent/game-sessions')
        .set('Authorization', authHeader())
        .send({ game_type_id: 'gt-1' });

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/game-sessions/:id/rounds
  // ═══════════════════════════════════
  describe('POST /v1/game-sessions/:id/rounds', () => {
    it('should start new round', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', current_round: 0, status: 'active' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'round-1', round_number: 1, status: 'active' }] }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/game-sessions/gs-1/rounds')
        .set('Authorization', authHeader());

      expect(res.status).toBe(201);
    });

    it('should reject for non-active session', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', current_round: 2, status: 'finished' }] }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/game-sessions/gs-1/rounds')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/game-sessions/actions
  // ═══════════════════════════════════
  describe('POST /v1/game-sessions/actions', () => {
    it('should submit action for active session & round', async () => {
      // getSession
      mockedQueryOne.mockResolvedValueOnce({ id: 'gs-1', status: 'active' });
      // round check
      mockedQueryOne.mockResolvedValueOnce({ id: 'round-1', status: 'active' });
      // insert action
      mockedQuery.mockResolvedValueOnce([{
        id: 'action-1', action_type: 'answer', payload: { answer: 42 },
      }]);

      const res = await request(app)
        .post('/v1/game-sessions/actions')
        .set('Authorization', authHeader())
        .send({
          game_session_id: 'gs-1',
          round_id: 'round-1',
          participant_id: 'p-1',
          action_type: 'answer',
          payload: { answer: 42 },
        });

      expect(res.status).toBe(201);
    });

    it('should reject action for inactive round', async () => {
      mockedQueryOne
        .mockResolvedValueOnce({ id: 'gs-1', status: 'active' })
        .mockResolvedValueOnce({ id: 'round-1', status: 'finished' });

      const res = await request(app)
        .post('/v1/game-sessions/actions')
        .set('Authorization', authHeader())
        .send({
          game_session_id: 'gs-1',
          round_id: 'round-1',
          participant_id: 'p-1',
          action_type: 'answer',
          payload: {},
        });

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/game-sessions/:id/finish
  // ═══════════════════════════════════
  describe('POST /v1/game-sessions/:id/finish', () => {
    it('should finish active session', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', status: 'active' }] }) // lock
            .mockResolvedValueOnce({ rows: [] }) // update status
            .mockResolvedValueOnce({ rows: [] }) // close rounds
            .mockResolvedValueOnce({ rows: [{ participant_id: 'p-1', action_count: '10' }] }) // results
            .mockResolvedValueOnce({ rows: [] }), // insert result
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/game-sessions/gs-1/finish')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Game session finished');
    });

    it('should reject finishing already-finished session', async () => {
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', status: 'finished' }] }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/game-sessions/gs-1/finish')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
    });
  });
});
