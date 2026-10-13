import { randomBytes } from 'node:crypto';

/** Rolling TTL per docs/API_SPEC.md "Session TTL policy" — extended on every authenticated request. */
export const SESSION_TTL_DAYS = 90;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionExpiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
