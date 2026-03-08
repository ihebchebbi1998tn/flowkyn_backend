/**
 * Socket Authentication Middleware — Security Tests
 * Tests for token verification on socket connections.
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));

import '../setup';
import { generateAccessToken, generateExpiredToken, TEST_USER } from '../helpers';
import { verifyAccessToken } from '../../src/utils/jwt';

describe('Socket Auth Middleware', () => {
  // ═══════════════════════════════════════════════════════
  //  Token Verification Logic (unit tests for the shared auth)
  // ═══════════════════════════════════════════════════════
  describe('token verification', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken();
      const payload = verifyAccessToken(token);

      expect(payload.userId).toBe(TEST_USER.userId);
      expect(payload.email).toBe(TEST_USER.email);
    });

    it('should reject an expired token', () => {
      const token = generateExpiredToken();

      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('should reject a malformed token', () => {
      expect(() => verifyAccessToken('not-a-valid-jwt')).toThrow();
    });

    it('should reject a token signed with wrong secret', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(TEST_USER, 'wrong-secret', { expiresIn: '15m' });

      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('should reject an empty string token', () => {
      expect(() => verifyAccessToken('')).toThrow();
    });
  });
});
