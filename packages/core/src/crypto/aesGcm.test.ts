import { describe, expect, it } from 'vitest';
import {
  CRYPTO_SCHEME_VERSION,
  decrypt,
  DecryptionError,
  encrypt,
  GCM_NONCE_LENGTH_BYTES,
} from './aesGcm.js';

const KEY = new Uint8Array(32).fill(0x3c);
const AAD = new TextEncoder().encode('user-id||1');

describe('encrypt/decrypt round-trip', () => {
  it('recovers the exact original plaintext', () => {
    const plaintext = new TextEncoder().encode('the quick brown fox');
    const wire = encrypt(KEY, plaintext, AAD);
    const recovered = decrypt(KEY, wire, AAD);
    expect(new TextDecoder().decode(recovered)).toBe('the quick brown fox');
  });

  it('round-trips empty plaintext', () => {
    const wire = encrypt(KEY, new Uint8Array(0), AAD);
    const recovered = decrypt(KEY, wire, AAD);
    expect(recovered.length).toBe(0);
  });

  it('wire format starts with cryptoSchemeVersion byte', () => {
    const wire = encrypt(KEY, new Uint8Array([1, 2, 3]), AAD);
    expect(wire[0]).toBe(CRYPTO_SCHEME_VERSION);
  });

  it('uses a fresh random nonce every call (never reused)', () => {
    const plaintext = new Uint8Array([9, 9, 9]);
    const wireA = encrypt(KEY, plaintext, AAD);
    const wireB = encrypt(KEY, plaintext, AAD);
    const nonceA = wireA.subarray(1, 1 + GCM_NONCE_LENGTH_BYTES);
    const nonceB = wireB.subarray(1, 1 + GCM_NONCE_LENGTH_BYTES);
    expect(Buffer.from(nonceA).equals(Buffer.from(nonceB))).toBe(false);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encrypt(new Uint8Array(16), new Uint8Array([1]), AAD)).toThrow(/32 bytes/);
  });
});

describe('negative / tamper tests', () => {
  it('fails to decrypt with the wrong key', () => {
    const wire = encrypt(KEY, new Uint8Array([1, 2, 3]), AAD);
    const wrongKey = new Uint8Array(32).fill(0x99);
    expect(() => decrypt(wrongKey, wire, AAD)).toThrow(DecryptionError);
  });

  it('fails to decrypt with mismatched AAD', () => {
    const wire = encrypt(KEY, new Uint8Array([1, 2, 3]), AAD);
    const wrongAad = new TextEncoder().encode('user-id||2');
    expect(() => decrypt(KEY, wire, wrongAad)).toThrow(DecryptionError);
  });

  it('fails to decrypt with a tampered ciphertext byte', () => {
    const wire = encrypt(KEY, new TextEncoder().encode('sensitive data'), AAD);
    const tampered = new Uint8Array(wire);
    tampered[tampered.length - 1] ^= 0xff; // flip last byte (inside auth tag)
    expect(() => decrypt(KEY, tampered, AAD)).toThrow(DecryptionError);
  });

  it('fails to decrypt with a tampered nonce', () => {
    const wire = encrypt(KEY, new TextEncoder().encode('sensitive data'), AAD);
    const tampered = new Uint8Array(wire);
    tampered[1] ^= 0xff; // flip first nonce byte
    expect(() => decrypt(KEY, tampered, AAD)).toThrow(DecryptionError);
  });

  it('rejects an unsupported cryptoSchemeVersion', () => {
    const wire = encrypt(KEY, new Uint8Array([1]), AAD);
    const badVersion = new Uint8Array(wire);
    badVersion[0] = 99;
    expect(() => decrypt(KEY, badVersion, AAD)).toThrow(/unsupported cryptoSchemeVersion/);
  });

  it('rejects wire input shorter than minimum valid length', () => {
    expect(() => decrypt(KEY, new Uint8Array(5), AAD)).toThrow(/too short/);
  });
});
