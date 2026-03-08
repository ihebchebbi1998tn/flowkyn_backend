import jwt from 'jsonwebtoken';

const ACCESS_SECRET = 'test-access-secret-key-32chars!!';
const REFRESH_SECRET = 'test-refresh-secret-key-32chars!';

export const TEST_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@flowkyn.com',
};

export const TEST_USER_2 = {
  userId: '00000000-0000-0000-0000-000000000002',
  email: 'user2@flowkyn.com',
};

export function generateAccessToken(payload = TEST_USER): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

export function generateRefreshToken(payload = TEST_USER): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
}

export function generateExpiredToken(): string {
  return jwt.sign(TEST_USER, ACCESS_SECRET, { expiresIn: '0s' });
}

export function authHeader(token?: string): string {
  return `Bearer ${token || generateAccessToken()}`;
}
