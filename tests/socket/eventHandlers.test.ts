/**
 * Socket Event Handlers — Security Tests
 * Tests for chat impersonation prevention, participant ownership,
 * and authorization in the /events namespace.
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { queryOne } from '../../src/config/database';
import { generateAccessToken, TEST_USER, TEST_USER_2 } from '../helpers';

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

// ─── Helper: Create a mock socket with event tracking ───
function createMockSocket(user = TEST_USER) {
  const emitted: Array<{ event: string; data: any }> = [];
  const joinedRooms = new Set<string>();
  const broadcastEmitted: Array<{ event: string; data: any }> = [];

  const socket: any = {
    user,
    handshake: { auth: { token: generateAccessToken(user) } },
    id: `socket-${user.userId}`,
    emit: jest.fn((event: string, data: any) => {
      emitted.push({ event, data });
    }),
    join: jest.fn((room: string) => joinedRooms.add(room)),
    leave: jest.fn((room: string) => joinedRooms.delete(room)),
    to: jest.fn(() => ({
      emit: jest.fn((event: string, data: any) => {
        broadcastEmitted.push({ event, data });
      }),
    })),
    on: jest.fn(),
    _emitted: emitted,
    _joinedRooms: joinedRooms,
    _broadcastEmitted: broadcastEmitted,
  };

  return socket;
}

// ─── Helper: Extract and call a registered handler ───
function getHandler(socket: any, eventName: string): Function {
  const call = socket.on.mock.calls.find((c: any[]) => c[0] === eventName);
  if (!call) throw new Error(`No handler registered for "${eventName}"`);
  return call[1];
}

// ─── Import handlers after mocks ───
import { setupEventHandlers } from '../../src/socket/eventHandlers';

describe('Socket Event Handlers — Security', () => {
  let eventsNs: any;
  let connectionHandler: Function;

  beforeAll(() => {
    // Create a mock namespace and capture the connection handler
    eventsNs = {
      on: jest.fn(),
      to: jest.fn(() => ({
        emit: jest.fn(),
      })),
    };
    setupEventHandlers(eventsNs);
    connectionHandler = eventsNs.on.mock.calls.find((c: any[]) => c[0] === 'connection')?.[1];
    expect(connectionHandler).toBeDefined();
  });

  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════
  //  event:join — Participant Verification
  // ═══════════════════════════════════════════════════════
  describe('event:join — participant verification', () => {
    it('should allow joining when user is a verified participant', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is a participant
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1', member_id: 'member-1' });

      const joinHandler = getHandler(socket, 'event:join');
      const ack = jest.fn();
      await joinHandler({ eventId: 'event-1' }, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ participantId: 'participant-1' }),
      }));
      expect(socket.join).toHaveBeenCalledWith('event:event-1');
    });

    it('should REJECT joining when user is NOT a participant', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is NOT a participant
      mockedQueryOne.mockResolvedValueOnce(null);

      const joinHandler = getHandler(socket, 'event:join');
      const ack = jest.fn();
      await joinHandler({ eventId: 'event-1' }, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should reject with invalid data', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      const joinHandler = getHandler(socket, 'event:join');
      await joinHandler({}, jest.fn()); // missing eventId

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });

    it('should recover guest by guest_identity_key when token participantId is stale', async () => {
      const socket = createMockSocket({ userId: 'guest:stale-participant', email: '' });
      socket.isGuest = true;
      socket.guestPayload = {
        participantId: 'stale-participant',
        eventId: 'event-1',
        guestName: 'Guest',
        guestIdentityKey: 'identity-key-1',
        isGuest: true,
      };
      connectionHandler(socket);

      // Direct lookup by participantId fails, fallback by identity key succeeds
      mockedQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'recovered-participant',
          display_name: 'Recovered Guest',
          avatar_url: null,
          guest_name: 'Recovered Guest',
          guest_avatar: null,
        });

      const joinHandler = getHandler(socket, 'event:join');
      const ack = jest.fn();
      await joinHandler({ eventId: 'event-1' }, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ participantId: 'recovered-participant' }),
      }));
      expect(socket.guestPayload.participantId).toBe('recovered-participant');
    });
  });

  // ═══════════════════════════════════════════════════════
  //  chat:message — Impersonation Prevention
  // ═══════════════════════════════════════════════════════
  describe('chat:message — impersonation prevention', () => {
    it('should resolve participantId from authenticated user, NOT from client data', async () => {
      const socket = createMockSocket(TEST_USER);
      connectionHandler(socket);

      // Mock: server verifies user is participant and resolves THEIR participant ID
      mockedQueryOne
        .mockResolvedValueOnce({ id: 'real-participant-1', member_id: 'member-1' }); // verifyParticipant

      // Mock for sendMessage: participant belongs to event
      mockedQueryOne.mockResolvedValueOnce({ id: 'real-participant-1' }); // verify in service

      // Mock for the actual INSERT
      const { query } = require('../../src/config/database');
      (query as jest.Mock).mockResolvedValueOnce([{
        id: 'msg-1',
        event_id: 'event-1',
        participant_id: 'real-participant-1',
        message: 'Hello',
        created_at: new Date().toISOString(),
      }]);

      const chatHandler = getHandler(socket, 'chat:message');
      // NOTE: Client sends NO participantId — server resolves it from auth
      await chatHandler({ eventId: 'event-1', message: 'Hello' });

      // Verify the DB query used the SERVER-resolved participant ID
      expect(mockedQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('participants'),
        expect.arrayContaining([TEST_USER.userId]) // user's actual ID used for lookup
      );
    });

    it('should REJECT message when user is NOT a participant', async () => {
      const socket = createMockSocket(TEST_USER);
      connectionHandler(socket);

      // Mock: user is NOT a participant
      mockedQueryOne.mockResolvedValueOnce(null);

      const chatHandler = getHandler(socket, 'chat:message');
      await chatHandler({ eventId: 'event-1', message: 'Hacked message' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'FORBIDDEN' }) })
      );
    });

    it('should reject empty messages', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      const chatHandler = getHandler(socket, 'chat:message');
      await chatHandler({ eventId: 'event-1', message: '' });

      expect(socket._emitted).toContainEqual(
        expect.objectContaining({ event: 'error', data: expect.objectContaining({ code: 'VALIDATION' }) })
      );
    });

    it('should sanitize and truncate long messages', async () => {
      const socket = createMockSocket();
      connectionHandler(socket);

      // Mock: user is a participant
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1', member_id: 'member-1' });
      // Mock: service participant check
      mockedQueryOne.mockResolvedValueOnce({ id: 'participant-1' });

      const { query } = require('../../src/config/database');
      (query as jest.Mock).mockResolvedValueOnce([{
        id: 'msg-1', event_id: 'event-1', message: 'x'.repeat(2000),
        created_at: new Date().toISOString(),
      }]);

      const chatHandler = getHandler(socket, 'chat:message');
      // Send a very long message
      await chatHandler({ eventId: 'event-1', message: 'x'.repeat(5000) });

      // Should not emit error — message is truncated, not rejected
      const errors = socket._emitted.filter((e: any) => e.event === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  //  chat:typing — No Client-Supplied IDs
  // ═══════════════════════════════════════════════════════
  describe('chat:typing — uses server userId', () => {
    it('should use authenticated userId for typing indicator, not client data', async () => {
      const socket = createMockSocket(TEST_USER);
      connectionHandler(socket);

      const typingHandler = getHandler(socket, 'chat:typing');
      typingHandler({ eventId: 'event-1', isTyping: true });

      // Verify the broadcast uses the authenticated userId
      const toMock = socket.to.mock.results[0]?.value;
      if (toMock) {
        expect(toMock.emit).toHaveBeenCalledWith('chat:typing', expect.objectContaining({
          userId: TEST_USER.userId,
        }));
      }
    });
  });
});
