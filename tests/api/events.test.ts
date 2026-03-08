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
 * --- New public endpoints ---
 * GET  /v1/events/:eventId/public
 * GET  /v1/events/:eventId/validate-token
 * POST /v1/events/:eventId/accept-invitation
 * POST /v1/events/:eventId/join-guest
 * GET  /v1/events/:eventId/participants
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
  role_name: 'owner',
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

  // ═══════════════════════════════════════════════════════════
  //  GET /v1/events/:eventId/public  (no auth required)
  // ═══════════════════════════════════════════════════════════
  describe('GET /v1/events/:eventId/public', () => {
    const mockPublicEvent = {
      id: 'event-1', title: 'Test Event', description: 'Desc',
      event_mode: 'sync', visibility: 'private', max_participants: 50,
      start_time: null, end_time: null, status: 'active', created_at: new Date().toISOString(),
      allow_guests: true, organization_name: 'Test Org', organization_logo: null,
    };

    it('should return public event info without authentication', async () => {
      mockedQueryOne.mockResolvedValueOnce(mockPublicEvent);
      mockedQuery.mockResolvedValueOnce([{ count: '3' }]);

      const res = await request(app)
        .get('/v1/events/event-1/public');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Event');
      expect(res.body.organization_name).toBe('Test Org');
      expect(res.body.participant_count).toBe(3);
    });

    it('should return 404 for non-existent event', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/events/nonexistent/public');

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  GET /v1/events/:eventId/validate-token  (no auth required)
  // ═══════════════════════════════════════════════════════════
  describe('GET /v1/events/:eventId/validate-token', () => {
    const validInvitation = {
      id: 'inv-1', email: 'guest@test.com', status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
      event_title: 'Test Event', event_description: 'Desc',
      event_mode: 'sync', event_status: 'active', organization_name: 'Test Org',
    };

    it('should validate a valid token', async () => {
      mockedQueryOne.mockResolvedValueOnce(validInvitation);

      const res = await request(app)
        .get('/v1/events/event-1/validate-token?token=valid-token-123');

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('guest@test.com');
      expect(res.body.event_title).toBe('Test Event');
    });

    it('should return 400 when no token provided', async () => {
      const res = await request(app)
        .get('/v1/events/event-1/validate-token');

      expect(res.status).toBe(400);
    });

    it('should return 404 for invalid token', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/events/event-1/validate-token?token=bad-token');

      expect(res.status).toBe(404);
    });

    it('should reject already-accepted invitation', async () => {
      mockedQueryOne.mockResolvedValueOnce({ ...validInvitation, status: 'accepted' });

      const res = await request(app)
        .get('/v1/events/event-1/validate-token?token=used-token');

      expect(res.status).toBe(400);
    });

    it('should reject expired invitation', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        ...validInvitation,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      });

      const res = await request(app)
        .get('/v1/events/event-1/validate-token?token=expired-token');

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  POST /v1/events/:eventId/accept-invitation  (auth required)
  // ═══════════════════════════════════════════════════════════
  describe('POST /v1/events/:eventId/accept-invitation', () => {
    const validInvitation = {
      id: 'inv-1', email: 'guest@test.com', status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      event_title: 'Test Event', event_description: 'Desc',
      event_mode: 'sync', event_status: 'active', organization_name: 'Test Org',
    };

    it('should accept invitation for logged-in user', async () => {
      // validateInvitationToken
      mockedQueryOne.mockResolvedValueOnce(validInvitation);
      // getById
      mockedQueryOne.mockResolvedValueOnce({ ...mockEvent, status: 'active' });
      // transaction
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // count participants
            .mockResolvedValueOnce({ rows: [] }) // insert participant
            .mockResolvedValueOnce({ rows: [] }), // update invitation status
        };
        return fn(mockClient as any);
      });
      // getMemberByUserId (existing org member)
      mockedQueryOne.mockResolvedValueOnce(mockMember);
      // check not already participating
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/events/event-1/accept-invitation')
        .set('Authorization', authHeader())
        .send({ token: 'valid-token-123' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('participant_id');
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/v1/events/event-1/accept-invitation')
        .send({ token: 'valid-token-123' });

      expect(res.status).toBe(401);
    });

    it('should require token in body', async () => {
      const res = await request(app)
        .post('/v1/events/event-1/accept-invitation')
        .set('Authorization', authHeader())
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  POST /v1/events/:eventId/join-guest  (no auth required)
  // ═══════════════════════════════════════════════════════════
  describe('POST /v1/events/:eventId/join-guest', () => {
    const guestEvent = { ...mockEvent, status: 'active', allow_guests: true };

    it('should allow guest to join public event without token', async () => {
      // getById (with allow_guests)
      mockedQueryOne.mockResolvedValueOnce({ ...guestEvent, visibility: 'public' });
      // transaction
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // count participants
            .mockResolvedValueOnce({ rows: [] }), // insert participant
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Guest User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('participant_id');
      expect(res.body.guest_name).toBe('Guest User');
    });

    it('should allow guest with avatar', async () => {
      mockedQueryOne.mockResolvedValueOnce({ ...guestEvent, visibility: 'public' });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ count: '3' }] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Avatar User', avatar_url: 'https://example.com/avatar.png' });

      expect(res.status).toBe(201);
    });

    it('should require token for private events', async () => {
      mockedQueryOne.mockResolvedValueOnce({ ...guestEvent, visibility: 'private' });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Guest User' });

      expect(res.status).toBe(403);
    });

    it('should reject when guests are not allowed', async () => {
      mockedQueryOne.mockResolvedValueOnce({ ...guestEvent, allow_guests: false });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Guest User' });

      expect(res.status).toBe(403);
    });

    it('should reject when name is empty', async () => {
      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('should reject when event is full', async () => {
      mockedQueryOne.mockResolvedValueOnce({ ...guestEvent, visibility: 'public', max_participants: 2 });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ count: '2' }] }), // already full
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Late Guest' });

      expect(res.status).toBe(400);
    });

    it('should allow guest with valid token on private event', async () => {
      // getById
      mockedQueryOne.mockResolvedValueOnce(guestEvent);
      // validateInvitationToken
      mockedQueryOne.mockResolvedValueOnce({
        id: 'inv-1', email: 'guest@test.com', status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        event_title: 'Test Event', organization_name: 'Test Org',
      });
      // transaction
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ count: '3' }] })
            .mockResolvedValueOnce({ rows: [] }) // insert participant
            .mockResolvedValueOnce({ rows: [] }), // update invitation
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/events/event-1/join-guest')
        .send({ name: 'Invited Guest', token: 'valid-token-123' });

      expect(res.status).toBe(201);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  GET /v1/events/:eventId/participants  (no auth required)
  // ═══════════════════════════════════════════════════════════
  describe('GET /v1/events/:eventId/participants', () => {
    const mockParticipants = [
      { id: 'p-1', participant_type: 'member', guest_name: null, guest_avatar: null, joined_at: '2026-03-01', user_name: 'Alex', user_avatar: null, user_email: 'alex@test.com', member_id: 'member-1' },
      { id: 'p-2', participant_type: 'guest', guest_name: 'Guest Lisa', guest_avatar: 'https://avatar.com/lisa.png', joined_at: '2026-03-02', user_name: null, user_avatar: null, user_email: null, member_id: null },
    ];

    it('should list participants without authentication', async () => {
      mockedQuery
        .mockResolvedValueOnce(mockParticipants)
        .mockResolvedValueOnce([{ count: '2' }]);

      const res = await request(app)
        .get('/v1/events/event-1/participants');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.data).toHaveLength(2);
      // Verify member mapping
      expect(res.body.data[0].name).toBe('Alex');
      expect(res.body.data[0].type).toBe('member');
      // Verify guest mapping
      expect(res.body.data[1].name).toBe('Guest Lisa');
      expect(res.body.data[1].type).toBe('guest');
      expect(res.body.data[1].email).toBeNull();
    });

    it('should support pagination params', async () => {
      mockedQuery
        .mockResolvedValueOnce([mockParticipants[0]])
        .mockResolvedValueOnce([{ count: '2' }]);

      const res = await request(app)
        .get('/v1/events/event-1/participants?page=1&limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.total).toBe(2);
    });

    it('should return empty list for event with no participants', async () => {
      mockedQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '0' }]);

      const res = await request(app)
        .get('/v1/events/event-1/participants');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
    });
  });
});
