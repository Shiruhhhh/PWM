import { describe, expect, it } from 'vitest';
import { buildVaultBlobAad } from './aad.js';

describe('buildVaultBlobAad', () => {
  it('is deterministic for the same userId + version', () => {
    const a = buildVaultBlobAad('user-abc', 1);
    const b = buildVaultBlobAad('user-abc', 1);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('differs for different userIds', () => {
    const a = buildVaultBlobAad('user-abc', 1);
    const b = buildVaultBlobAad('user-xyz', 1);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('differs for different versions', () => {
    const a = buildVaultBlobAad('user-abc', 1);
    const b = buildVaultBlobAad('user-abc', 2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('encodes version as 4-byte big-endian uint32 appended to UTF-8 userId', () => {
    const out = buildVaultBlobAad('ab', 1);
    expect(out.length).toBe(2 + 4);
    expect(Array.from(out)).toEqual([0x61, 0x62, 0x00, 0x00, 0x00, 0x01]);
  });
});
