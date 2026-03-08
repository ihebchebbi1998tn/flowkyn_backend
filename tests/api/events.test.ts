/**
 * Events API tests
 * POST /v1/events
 * GET  /v1/events
 * GET  /v1/events/:eventId
 * PUT  /v1/events/:eventId
 * DELETE /v1/events/:eventId
 * POST /v1/events/:eventId/invite
 * POST /v1/events/:eventId/join
 * POST /v1/events/:eventId/leave
 * POST /v1/events/:eventId/messages
 * GET  /v1/events/:eventId/messages
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne, transaction } from '../../src/config/database';
import { authHeader, TEST_USER } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;

const mockEvent = {
  id: 'event-1',
  organization_id: 'org-1',
  created_by_member_id: 'member-1',
  title: 'Test Event',
  description: '',
  event_mode: 'sync',
  visibility: 'private',
  max_participants: 50,
  status: 'draft',
};

const mockMember = {
  id: 'member-1',
  organization_id: 'org-1',
  user_id: TEST_USER.userId,
  role_id: 'role-1',
  status: 'active',
};

describe('Events API', () => {
  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════
  //  POST /v1/events
  // ═══════════════════════════════════
  describe('POST /v1/events', () => {
    it('should create event when user is org member', async () => {
      mockedQueryOne.mockResolvedValueOnce(mockMember); // getMemberByUserId
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [mockEvent] }) // insert event
            .mockResolvedValueOnce({ rows: [] }), // insert event_settings
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/events')
        .set('Authorization', authHeader())
        .send({ organization_id: 'org-1', title: 'Test Event' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Test Event');
    });

    it('should reject event creation from non-member', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/events')
        .set('Authorization', authHeader())
        .send({ organization_id: 'org-1', title: 'Test Event' });

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/v1/events')
        .send({ organization_id: 'org-1', title: 'Event' });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/events
  // ═══════════════════════════════════
  describe('GET /v1/events', () => {
    it('should list events', async () => {
      mockedQuery
        .mockResolvedValueOnce([mockEvent]) // events
        .mockResolvedValueOnce([{ count: '1' }]); // count

      const res = await request(app)
        .get('/v1/events')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/events/:eventId
  // ═══════════════════════════════════
  describe('GET /v1/events/:eventId', () => {
    it('should return event by id', async () => {
      mockedQueryOne.mockResolvedValueOnce(mockEvent);

      const res = await request(app)
        .get('/v1/events/event-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Event');
    });

    it('should return 404 for non-existent event', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/events/nonexistent')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════
  //  PUT /v1/events/:eventId
  // ═══════════════════════════════════
  describe('PUT /v1/events/:eventId', () => {
    it('should update event when user is org member', async () => {
      mockedQueryOne
        .mockResolvedValueOnce(mockEvent) // getById
        .mockResolvedValueOnce(mockMember); // getMemberByUserId

      mockedQuery.mockResolvedValueOnce([{ ...mockEvent, title: 'Updated Title' }]); // update

      const res = await request(app)
        .put('/v1/events/event-1')
        .set('Authorization', authHeader())
        .send({ title: 'Updated Title' });

      expect(res.status).toBe(200);
    });

    it('should reject update from non-org-member', async () => {
      mockedQueryOne
        .mockResolvedValueOnce(mockEvent) // getById
        .mockResolvedValueOnce(null); // not a member

      const res = await request(app)
        .put('/v1/events/event-1')
        .set('Authorization', authHeader())
        .send({ title: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════
  //  DELETE /v1/events/:eventId
  // ═══════════════════════════════════
  describe('DELETE /v1/events/:eventId', () => {
    it('should delete event when user is org member', async () => {
      mockedQueryOne
        .mockResolvedValueOnce(mockEvent)
        .mockResolvedValueOnce(mockMember);
      mockedQuery.mockResolvedValueOnce([{ id: 'event-1' }]);

      const res = await request(app)
        .delete('/v1/events/event-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
    });

    it('should reject delete from non-org-member', async () => {
      mockedQueryOne
        .mockResolvedValueOnce(mockEvent)
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/v1/events/event-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/events/:eventId/join
  // ═══════════════════════════════════
  describe('POST /v1/events/:eventId/join', () => {
    it('should join event as org member', async () => {
      // getById in controller
      mockedQueryOne.mockResolvedValueOnce(mockEvent);
      // getMemberByUserId
      mockedQueryOne.mockResolvedValueOnce(mockMember);
      // duplicate check in service
      mockedQueryOne.mockResolvedValueOnce(null);
      // getById in service
      mockedQueryOne.mockResolvedValueOnce(mockEvent);
      // count participants
      mockedQuery.mockResolvedValueOnce([{ count: '5' }]);
      // insert participant
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/v1/events/event-1/join')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('participant_id');
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/events/:eventId/messages
  // ═══════════════════════════════════
  describe('POST /v1/events/:eventId/messages', () => {
    it('should send message to event', async () => {
      // verify participant
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1' });
      // insert message
      mockedQuery.mockResolvedValueOnce([{
        id: 'msg-1', event_id: 'event-1', message: 'Hello!', message_type: 'text',
      }]);

      const res = await request(app)
        .post('/v1/events/event-1/messages')
        .set('Authorization', authHeader())
        .send({ participant_id: 'participant-1', message: 'Hello!' });

      expect(res.status).toBe(201);
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/events/:eventId/messages
  // ═══════════════════════════════════
  describe('GET /v1/events/:eventId/messages', () => {
    it('should list event messages with pagination', async () => {
      mockedQuery
        .mockResolvedValueOnce([{ id: 'msg-1', message: 'Hello', message_type: 'text' }])
        .mockResolvedValueOnce([{ count: '1' }]);

      const res = await request(app)
        .get('/v1/events/event-1/messages')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });
  });
});
