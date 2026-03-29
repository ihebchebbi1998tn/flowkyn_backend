/**
 * Organizations API tests
 * POST /v1/organizations
 * GET  /v1/organizations/:orgId
 * GET  /v1/organizations/:orgId/members
 * POST /v1/organizations/:orgId/invite
 * POST /v1/organizations/accept-invitation
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne, transaction } from '../../src/config/database';
import { sendEmail } from '../../src/services/email.service';
import { authHeader, TEST_USER } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;

describe('Organizations API', () => {
  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════
  //  POST /v1/organizations
  // ═══════════════════════════════════
  describe('POST /v1/organizations', () => {
    it('should create organization', async () => {
      mockedQueryOne
        .mockResolvedValueOnce(null) // slug check
        .mockResolvedValueOnce({ id: 'role-owner-id' }); // owner role
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'org-1', name: 'Test Org', slug: 'test-org' }] }) // insert org
            .mockResolvedValueOnce({ rows: [] }) // insert member
            .mockResolvedValueOnce({ rows: [] }), // insert subscription
        };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/organizations')
        .set('Authorization', authHeader())
        .send({ name: 'Test Org' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Org');
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/v1/organizations')
        .send({ name: 'Test Org' });

      expect(res.status).toBe(401);
    });

    it('should reject missing name', async () => {
      const res = await request(app)
        .post('/v1/organizations')
        .set('Authorization', authHeader())
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/organizations/:orgId
  // ═══════════════════════════════════
  describe('GET /v1/organizations/:orgId', () => {
    it('should return organization details', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        owner_user_id: TEST_USER.userId,
      });

      const res = await request(app)
        .get('/v1/organizations/org-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test Org');
    });

    it('should return 404 for non-existent org', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/v1/organizations/non-existent')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════
  //  GET /v1/organizations/:orgId/members
  // ═══════════════════════════════════
  describe('GET /v1/organizations/:orgId/members', () => {
    it('should list members', async () => {
      mockedQuery.mockResolvedValueOnce([
        { id: 'member-1', user_id: TEST_USER.userId, name: 'Test User', role_name: 'owner' },
      ]);

      const res = await request(app)
        .get('/v1/organizations/org-1/members')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/organizations/:orgId/invite
  // ═══════════════════════════════════
  describe('POST /v1/organizations/:orgId/invite', () => {
    it('should invite a member when user is org member', async () => {
      // getMemberByUserId
      mockedQueryOne.mockResolvedValueOnce({
        id: 'member-1', organization_id: 'org-1', user_id: TEST_USER.userId, role_id: 'role-1',
      });
      // getById (inside inviteMember)
      mockedQueryOne.mockResolvedValueOnce({
        id: 'org-1', name: 'Test Org', slug: 'test-org',
      });
      // insert invitation
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/v1/organizations/org-1/invite')
        .set('Authorization', authHeader())
        .send({ email: 'invitee@flowkyn.com', role_id: 'role-member' });

      expect(res.status).toBe(200);
    });

    it('should reject invitation from non-member', async () => {
      mockedQueryOne.mockResolvedValueOnce(null); // not a member

      const res = await request(app)
        .post('/v1/organizations/org-1/invite')
        .set('Authorization', authHeader())
        .send({ email: 'invitee@flowkyn.com', role_id: 'role-member' });

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════
  //  POST /v1/organizations/accept-invitation
  // ═══════════════════════════════════
  describe('POST /v1/organizations/accept-invitation', () => {
    it('should accept valid invitation', async () => {
      mockedQueryOne.mockResolvedValueOnce({
        id: 'inv-1',
        organization_id: 'org-1',
        role_id: 'role-member',
        invited_by_member_id: 'member-1',
      });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        return fn(mockClient as any);
      });

      const res = await request(app)
        .post('/v1/organizations/accept-invitation')
        .set('Authorization', authHeader())
        .send({ token: 'valid-invite-token' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Invitation accepted');
    });

    it('should reject invalid/expired invitation', async () => {
      mockedQueryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/v1/organizations/accept-invitation')
        .set('Authorization', authHeader())
        .send({ token: 'expired-token' });

      expect(res.status).toBe(400);
    });
  });
});
