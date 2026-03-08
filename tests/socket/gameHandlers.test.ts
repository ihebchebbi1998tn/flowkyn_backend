/**
 * Socket Game Handlers — Security Tests
 * Tests for game authorization (start/end), participant ownership,
 * and impersonation prevention in the /games namespace.
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import { queryOne, query, transaction } from '../../src/config/database';
import { generateAccessToken, TEST_USER, TEST_USER_2 } from '../helpers';

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;

// ─── Helper: Create a mock socket ───
function createMockSocket(user = TEST_USER) {
  const emitted: Array<{ event: string; data: any }> = [];
  const joinedRooms = new Set<string>();

  const socket: any = {
    user,
    id: `socket-${user.userId}`,
    emit: jest.fn((event: string, data: any) => emitted.push({ event, data })),
    join: jest.fn((room: string) => joinedRooms.add(room)),
    leave: jest.fn((room: string) => joinedRooms.delete(room)),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn(),
    _emitted: emitted,
    _joinedRooms: joinedRooms,
  };
  return socket;
}

function getHandler(socket: any, eventName: string): Function {
  const call = socket.on.mock.calls.find((c: any[]) => c[0] === eventName);
  if (!call) throw new Error(`No handler registered for "${eventName}"`);
  return call[1];
}

import { setupGameHandlers } from '../../src/socket/gameHandlers';

describe('Socket Game Handlers — Security', () => {
  let gamesNs: any;
  let connectionHandler: Function;

  beforeAll(() => {
    gamesNs = {
      on: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
    };
    setupGameHandlers(gamesNs);
    connectionHandler = gamesNs.on.mock.calls.find((c: any[]) => c[0] === 'connection')?.[1];
    expect(connectionHandler).toBeDefined();
  });

  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════
  //  game:join — Participant Verification
  // ═══════════════════════════════════════════════════════
  describe('game:join — participant verification', () => {
    it('should allow joining when user is a participant in the game event', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is a participant
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1' });
      // Mock: getSession
      mockedQueryOne.mockResolvedValueOnce({ id: 'gs-1', status: 'active', current_round: 0 });

      const joinHandler = getHandler(socket, 'game:join');
      const ack = jest.fn();
      await joinHandler({ sessionId: 'gs-1' }, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ participantId: 'participant-1' }),
      }));
      expect(socket.join).toHaveBeenCalledWith('game:gs-1');
    });

    it('should REJECT joining when user is NOT a participant', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is NOT a participant
      mockedQueryOne.mockResolvedValueOnce(null);

      const joinHandler = getHandler(socket, 'game:join');
      const ack = jest.fn();
      await joinHandler({ sessionId: 'gs-1' }, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:start — Admin Authorization
  // ═══════════════════════════════════════════════════════
  describe('game:start — admin authorization', () => {
    it('should REJECT game start from non-admin user', async () => {
      const socket = createMockSocket(TEST_USER_2);
      connectionHandler(socket);

      // Mock: user has "user" role (not admin)
      mockedQueryOne.mockResolvedValueOnce({ name: 'user' });

      const startHandler = getHandler(socket, 'game:start');
      await startHandler({ sessionId: 'gs-1' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should allow game start from admin user', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user has admin role
      mockedQueryOne.mockResolvedValueOnce({ name: 'admin' });

      // Mock: startRound transaction
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', current_round: 0, status: 'active' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'round-1', round_number: 1, status: 'active' }] }),
        };
        return fn(mockClient as any);
      });

      const startHandler = getHandler(socket, 'game:start');
      await startHandler({ sessionId: 'gs-1' });

      // Should NOT emit error
      const errors = socket._emitted.filter((e: any) => e.event === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should allow game start from moderator', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      mockedQueryOne.mockResolvedValueOnce({ name: 'moderator' });
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', current_round: 0, status: 'active' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'round-1', round_number: 1 }] }),
        };
        return fn(mockClient as any);
      });

      const startHandler = getHandler(socket, 'game:start');
      await startHandler({ sessionId: 'gs-1' });

      const errors = socket._emitted.filter((e: any) => e.event === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:end — Admin Authorization
  // ═══════════════════════════════════════════════════════
  describe('game:end — admin authorization', () => {
    it('should REJECT game end from non-admin user', async () => {
      const socket = createMockSocket(TEST_USER_2);
      connectionHandler(socket);

      // Mock: user has "user" role
      mockedQueryOne.mockResolvedValueOnce({ name: 'user' });

      const endHandler = getHandler(socket, 'game:end');
      await endHandler({ sessionId: 'gs-1' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should allow game end from owner', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user has owner role
      mockedQueryOne.mockResolvedValueOnce({ name: 'owner' });

      // Mock: finishSession transaction
      mockedTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'gs-1', status: 'active' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }), // no actions
        };
        return fn(mockClient as any);
      });

      const endHandler = getHandler(socket, 'game:end');
      await endHandler({ sessionId: 'gs-1' });

      const errors = socket._emitted.filter((e: any) => e.event === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:round_start — Admin Authorization
  // ═══════════════════════════════════════════════════════
  describe('game:round_start — admin authorization', () => {
    it('should REJECT round start from non-admin', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      mockedQueryOne.mockResolvedValueOnce({ name: 'user' });

      const roundHandler = getHandler(socket, 'game:round_start');
      await roundHandler({ sessionId: 'gs-1', roundNumber: 2 });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:round_end — Admin Authorization & DB Persistence
  // ═══════════════════════════════════════════════════════
  describe('game:round_end — admin authorization & persistence', () => {
    it('should REJECT round end from non-admin', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      mockedQueryOne.mockResolvedValueOnce({ name: 'user' });

      const roundEndHandler = getHandler(socket, 'game:round_end');
      await roundEndHandler({ sessionId: 'gs-1', roundId: 'round-1' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should persist round end to DB when admin ends it', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: admin role
      mockedQueryOne.mockResolvedValueOnce({ name: 'admin' });
      // Mock: DB update
      mockedQueryOne.mockResolvedValueOnce({ id: 'round-1' });

      const roundEndHandler = getHandler(socket, 'game:round_end');
      await roundEndHandler({ sessionId: 'gs-1', roundId: 'round-1' });

      // Verify DB was called to update the round
      expect(mockedQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE game_rounds'),
        expect.arrayContaining(['round-1', 'gs-1'])
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:action — Participant Ownership
  // ═══════════════════════════════════════════════════════
  describe('game:action — participant ownership', () => {
    it('should resolve participantId from authenticated user, preventing impersonation', async () => {
      const socket = createMockSocket(TEST_USER);
      connectionHandler(socket);

      // Mock: verifyGameParticipant — resolves user's actual participant ID
      mockedQueryOne.mockResolvedValueOnce({ id: 'real-participant-for-user1' });

      // Mock: getSession
      mockedQueryOne.mockResolvedValueOnce({ id: 'gs-1', status: 'active', event_id: 'event-1' });
      // Mock: round check
      mockedQueryOne.mockResolvedValueOnce({ id: 'round-1', status: 'active' });
      // Mock: participant validation in submitAction
      mockedQueryOne.mockResolvedValueOnce({ id: 'real-participant-for-user1' });
      // Mock: INSERT action
      mockedQuery.mockResolvedValueOnce([{
        id: 'action-1', action_type: 'answer', created_at: new Date().toISOString(),
      }]);

      const actionHandler = getHandler(socket, 'game:action');
      // Client sends NO participantId — server resolves it
      await actionHandler({
        sessionId: 'gs-1',
        roundId: 'round-1',
        actionType: 'answer',
        payload: { answer: 42 },
      });

      // The first queryOne call should use the authenticated userId
      expect(mockedQueryOne.mock.calls[0][1]).toContain(TEST_USER.userId);
    });

    it('should REJECT action when user is NOT a game participant', async () => {
      const socket = createMockSocket(TEST_USER_2);
      connectionHandler(socket);

      // Mock: user is NOT a participant
      mockedQueryOne.mockResolvedValueOnce(null);

      const actionHandler = getHandler(socket, 'game:action');
      await actionHandler({
        sessionId: 'gs-1',
        roundId: 'round-1',
        actionType: 'answer',
        payload: {},
      });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should reject oversized payloads', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is a participant
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1' });

      const actionHandler = getHandler(socket, 'game:action');
      await actionHandler({
        sessionId: 'gs-1',
        roundId: 'round-1',
        actionType: 'answer',
        payload: { data: 'x'.repeat(20000) }, // >10KB
      });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  //  game:state_sync — Participant Access Only
  // ═══════════════════════════════════════════════════════
  describe('game:state_sync — participant access', () => {
    it('should REJECT state sync from non-participant', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      mockedQueryOne.mockResolvedValueOnce(null); // not a participant

      const stateHandler = getHandler(socket, 'game:state_sync');
      await stateHandler({ sessionId: 'gs-1' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should return game state to verified participant', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: participant exists
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1' });
      // Mock: getSession
      mockedQueryOne.mockResolvedValueOnce({
        id: 'gs-1', status: 'active', current_round: 2,
        started_at: '2026-01-01T00:00:00Z', ended_at: null,
      });

      const stateHandler = getHandler(socket, 'game:state_sync');
      await stateHandler({ sessionId: 'gs-1' });

      expect(socket.emit).toHaveBeenCalledWith('game:state', expect.objectContaining({
        sessionId: 'gs-1',
        state: expect.objectContaining({ status: 'active', currentRound: 2 }),
      }));
    });
  });

  // ═══════════════════════════════════════════════════════
  //  Validation — Invalid/Missing Data
  // ═══════════════════════════════════════════════════════
  describe('input validation', () => {
    it('should reject game:join with missing sessionId', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      const joinHandler = getHandler(socket, 'game:join');
      await joinHandler({}, jest.fn());

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });

    it('should reject game:action with missing fields', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      const actionHandler = getHandler(socket, 'game:action');
      await actionHandler({ sessionId: 'gs-1' }); // missing roundId and actionType

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });

    it('should reject game:round_start with invalid round number', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      const roundHandler = getHandler(socket, 'game:round_start');
      await roundHandler({ sessionId: 'gs-1', roundNumber: -1 });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });
  });
});
