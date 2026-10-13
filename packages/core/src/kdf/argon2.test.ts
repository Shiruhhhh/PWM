import { describe, expect, it } from 'vitest';
import { ARGON2ID_PARAMS, deriveMasterKey, hashAuthKey } from './argon2.js';

const FIXED_SALT = new Uint8Array(16).fill(0x42);

describe('deriveMasterKey', () => {
  it('known-answer: fixed password+salt+params -> fixed 32-byte output', async () => {
    const out = await deriveMasterKey('correct horse battery staple', FIXED_SALT);
    expect(Buffer.from(out).toString('hex')).toBe(
      'dde64ab2660a0dedd449fa0414587bd0407e68ebe4a3f1595f2c167f1f7ff3cd',
    );
  });

  it('rejects a salt of the wrong length', async () => {
    await expect(deriveMasterKey('pw', new Uint8Array(8))).rejects.toThrow(/16 bytes/);
  });

  it('is deterministic for the same password+salt+params', async () => {
    const a = await deriveMasterKey('same password', FIXED_SALT);
    const b = await deriveMasterKey('same password', FIXED_SALT);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('differs for different passwords', async () => {
    const a = await deriveMasterKey('password one', FIXED_SALT);
    const b = await deriveMasterKey('password two', FIXED_SALT);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('differs for different salts', async () => {
    const otherSalt = new Uint8Array(16).fill(0x99);
    const a = await deriveMasterKey('same password', FIXED_SALT);
    const b = await deriveMasterKey('same password', otherSalt);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('uses exact spec params', () => {
    expect(ARGON2ID_PARAMS).toEqual({
      algorithm: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 4,
      hashLength: 32,
    });
  });
});

describe('hashAuthKey', () => {
  it('known-answer: fixed authKey+serverSalt -> fixed 32-byte output', async () => {
    const authKey = new Uint8Array(32).fill(0x11);
    const serverSalt = new Uint8Array(16).fill(0x55);
    const out = await hashAuthKey(authKey, serverSalt);
    expect(Buffer.from(out).toString('hex')).toBe(
      '5262fe5c002196569cbf564f2c442a8d541bd1d331171beda1995e5ead069b17',
    );
  });

  it('is independent of deriveMasterKey (different domain)', async () => {
    const authKey = new Uint8Array(32).fill(0x11);
    const viaAuthHash = await hashAuthKey(authKey, FIXED_SALT);
    const viaMasterKey = await deriveMasterKey('irrelevant', FIXED_SALT);
    expect(Buffer.from(viaAuthHash).equals(Buffer.from(viaMasterKey))).toBe(false);
  });
});
