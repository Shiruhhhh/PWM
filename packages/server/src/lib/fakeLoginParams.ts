import { createHmac } from 'node:crypto';
import type { KdfParams } from '@pwm/core';

/**
 * Deterministic-but-fake clientSalt for a nonexistent username, per
 * docs/API_SPEC.md's anti-enumeration requirement on GET /login/params.
 * HMAC-derived from username + server secret: same nonexistent username
 * always gets the same fake salt (matching a real account's stable salt
 * across repeat calls), but there's no fixed/zero pattern to detect.
 */
export function fakeClientSalt(username: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(username).digest().subarray(0, 16);
}

export const FAKE_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 4,
};

/**
 * Deterministic-but-fake wrappedVaultKeyRecovery for GET
 * /recovery/wrapped-key on a nonexistent username — same
 * anti-enumeration rationale as fakeClientSalt above. Wrapped vaultKey
 * wire format is 1(version) + 12(nonce) + 32(key) + 16(tag) = 61 bytes.
 */
const FAKE_WRAPPED_KEY_LENGTH_BYTES = 61;

export function fakeWrappedVaultKeyRecovery(username: string, secret: string): Buffer {
  const a = createHmac('sha256', `${secret}:recovery:a`).update(username).digest();
  const b = createHmac('sha256', `${secret}:recovery:b`).update(username).digest();
  return Buffer.concat([a, b]).subarray(0, FAKE_WRAPPED_KEY_LENGTH_BYTES);
}
