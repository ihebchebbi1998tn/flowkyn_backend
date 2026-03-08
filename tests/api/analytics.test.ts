/**
 * Analytics API tests
 * POST /v1/analytics/track
 * GET  /v1/analytics/dashboard
 * GET  /v1/analytics/overview
 * GET  /v1/analytics/active-sessions
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

  // ── POST /v1/analytics/track ───────────────────────────────────────────────

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

  // ── GET /v1/analytics/dashboard ────────────────────────────────────────────

  describe('GET /v1/analytics/dashboard', () => {
    it('should return empty stats when user has no orgs', async () => {
      // organization_members query returns empty
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/v1/analytics/dashboard')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.activeSessions).toBe(0);
      expect(res.body.teamMembers).toBe(0);
      expect(res.body.totalEvents).toBe(0);
      expect(res.body.completedSessions).toBe(0);
      expect(res.body.upcomingEvents).toEqual([]);
      expect(res.body.recentActivity).toEqual([]);
    });

    it('should return aggregated stats when user has orgs', async () => {
      // 1. org membership query
      mockedQuery.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      // 2-7: parallel queries (active_sessions, team_members, total_events, completed_sessions, upcomingEvents, recentActivity)
      mockedQuery.mockResolvedValueOnce([{ active_sessions: '3' }]);
      mockedQuery.mockResolvedValueOnce([{ team_members: '12' }]);
      mockedQuery.mockResolvedValueOnce([{ total_events: '5' }]);
      mockedQuery.mockResolvedValueOnce([{ completed_sessions: '8' }]);
      mockedQuery.mockResolvedValueOnce([
        { id: 'ev-1', title: 'Team Standup', event_mode: 'sync', start_time: '2026-03-10T10:00:00Z', status: 'active', max_participants: 20, participant_count: 8 },
      ]);
      mockedQuery.mockResolvedValueOnce([
        { id: 'gs-1', status: 'finished', current_round: 3, started_at: '2026-03-08T09:00:00Z', ended_at: '2026-03-08T09:30:00Z', game_type_name: 'Two Truths', game_type_key: 'two_truths', event_title: 'Team Standup' },
      ]);

      const res = await request(app)
        .get('/v1/analytics/dashboard')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.activeSessions).toBe(3);
      expect(res.body.teamMembers).toBe(12);
      expect(res.body.totalEvents).toBe(5);
      expect(res.body.completedSessions).toBe(8);
      expect(res.body.upcomingEvents).toHaveLength(1);
      expect(res.body.recentActivity).toHaveLength(1);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/analytics/dashboard');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /v1/analytics/overview ─────────────────────────────────────────────

  describe('GET /v1/analytics/overview', () => {
    it('should return empty overview when user has no orgs', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/v1/analytics/overview')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.engagementTrend).toEqual([]);
      expect(res.body.activityBreakdown).toEqual([]);
      expect(res.body.topActivities).toEqual([]);
      expect(res.body.stats.totalSessions).toBe(0);
    });

    it('should return overview with engagement data', async () => {
      // 1. org membership
      mockedQuery.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      // 2-5: parallel queries (engagementTrend, activityBreakdown, topActivities, stats)
      mockedQuery.mockResolvedValueOnce([
        { month: 'Jan', month_num: 1, sessions: '10', completed: '8' },
        { month: 'Feb', month_num: 2, sessions: '15', completed: '12' },
      ]);
      mockedQuery.mockResolvedValueOnce([
        { name: 'Two Truths', category: 'icebreaker', sessions: '12', participants: '45' },
      ]);
      mockedQuery.mockResolvedValueOnce([
        { name: 'Two Truths', category: 'icebreaker', sessions: '12', participants: '45', total_actions: '130' },
      ]);
      mockedQuery.mockResolvedValueOnce([
        { total_sessions: '25', total_participants: '80', completion_rate: '82.5' },
      ]);

      const res = await request(app)
        .get('/v1/analytics/overview')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.engagementTrend).toHaveLength(2);
      expect(res.body.activityBreakdown).toHaveLength(1);
      expect(res.body.topActivities).toHaveLength(1);
      expect(res.body.stats.totalSessions).toBe(25);
      expect(res.body.stats.totalParticipants).toBe(80);
      expect(res.body.stats.completionRate).toBe(82.5);
    });

    it('should accept months query param', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/v1/analytics/overview?months=3')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/analytics/overview');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /v1/analytics/active-sessions ──────────────────────────────────────

  describe('GET /v1/analytics/active-sessions', () => {
    it('should return active sessions', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'gs-1', event_id: 'ev-1', game_type_id: 'gt-1', status: 'active',
          current_round: 2, game_duration_minutes: 15, started_at: '2026-03-08T09:00:00Z',
          metadata: {}, game_type_name: 'Coffee Roulette', game_type_key: 'coffee_roulette',
          event_title: 'Friday Fun', organization_name: 'Acme Corp',
        },
      ]);

      const res = await request(app)
        .get('/v1/analytics/active-sessions')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].game_type_key).toBe('coffee_roulette');
      expect(res.body[0].status).toBe('active');
    });

    it('should return empty array when no active sessions', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/v1/analytics/active-sessions')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/analytics/active-sessions');
      expect(res.status).toBe(401);
    });
  });
});
