import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthPayload, GuestPayload } from '../types';

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn as any,
  });
}

export function signRefreshToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn as any,
  });
}

export function verifyAccessToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret) as any;
  // Guest tokens are signed with the same secret but must not be accepted
  // as authenticated user access tokens.
  if (decoded?.isGuest) {
    throw new Error('Guest token is not a user access token');
  }
  return decoded as AuthPayload;
}

export function verifyRefreshToken(token: string): AuthPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as AuthPayload;
}

/**
 * Sign a short-lived guest token for game/chat participation.
 * Contains participantId and eventId — no userId (guests are anonymous).
 */
export function signGuestToken(payload: GuestPayload): string {
  return jwt.sign({ ...payload, isGuest: true }, env.jwt.accessSecret, {
    expiresIn: '24h',
  });
}

/**
 * Verify a guest token — returns GuestPayload if valid.
 * Throws if the token is invalid/expired or not a guest token.
 */
export function verifyGuestToken(token: string): GuestPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret) as any;
  if (!decoded.isGuest) throw new Error('Not a guest token');
  return {
    participantId: decoded.participantId,
    eventId: decoded.eventId,
    guestName: decoded.guestName,
    isGuest: true,
  };
}
