import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';

/**
 * Wire/storage format per CRYPTO_SPEC.md §3:
 * cryptoSchemeVersion(1 byte) || nonce(12 bytes) || ciphertext || authTag(16 bytes)
 *
 * `@noble/ciphers` gcm().encrypt() already returns ciphertext with the
 * 16-byte auth tag appended, so the wire format is just
 * [version, ...nonce, ...(ciphertext||tag)].
 */
export const CRYPTO_SCHEME_VERSION = 1;
export const GCM_NONCE_LENGTH_BYTES = 12;
export const GCM_TAG_LENGTH_BYTES = 16;

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Encrypts `plaintext` under `key` (32 bytes) with a fresh random nonce.
 * `aad` binds the ciphertext to context (e.g. userId || blobFormatVersion)
 * and must match exactly on decrypt.
 */
export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error(`key must be 32 bytes, got ${key.length}`);
  }
  const nonce = randomBytes(GCM_NONCE_LENGTH_BYTES);
  const ciphertextAndTag = gcm(key, nonce, aad).encrypt(plaintext);

  const out = new Uint8Array(1 + GCM_NONCE_LENGTH_BYTES + ciphertextAndTag.length);
  out[0] = CRYPTO_SCHEME_VERSION;
  out.set(nonce, 1);
  out.set(ciphertextAndTag, 1 + GCM_NONCE_LENGTH_BYTES);
  return out;
}

/**
 * Decrypts a blob produced by `encrypt`. Throws `DecryptionError` on any
 * failure — wrong key, tampered ciphertext/tag, or unsupported scheme
 * version — never partially succeeds.
 */
export function decrypt(key: Uint8Array, wire: Uint8Array, aad: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error(`key must be 32 bytes, got ${key.length}`);
  }
  if (wire.length < 1 + GCM_NONCE_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES) {
    throw new DecryptionError('wire format too short');
  }

  const version = wire[0];
  if (version !== CRYPTO_SCHEME_VERSION) {
    throw new DecryptionError(`unsupported cryptoSchemeVersion: ${version}`);
  }

  const nonce = wire.subarray(1, 1 + GCM_NONCE_LENGTH_BYTES);
  const ciphertextAndTag = wire.subarray(1 + GCM_NONCE_LENGTH_BYTES);

  try {
    return gcm(key, nonce, aad).decrypt(ciphertextAndTag);
  } catch (err) {
    throw new DecryptionError(`GCM authentication failed: ${(err as Error).message}`);
  }
}
