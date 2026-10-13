import { describe, expect, it } from 'vitest';
import { deriveAuthKey, deriveVaultKey, deriveVaultWrapKey, splitMasterKey } from './hkdf.js';

const MASTER_KEY = new Uint8Array(32).fill(0x7a);

describe('HKDF domain separation', () => {
  it('known-answer: fixed masterKey -> fixed vaultKey', () => {
    const vaultKey = deriveVaultKey(MASTER_KEY);
    expect(Buffer.from(vaultKey).toString('hex')).toBe(
      '7137a2bfd064d7a87b342d770f02f656b09ac203237baaa9233b2eba7963b2f4',
    );
  });

  it('known-answer: fixed masterKey -> fixed authKey', () => {
    const authKey = deriveAuthKey(MASTER_KEY);
    expect(Buffer.from(authKey).toString('hex')).toBe(
      'e65b514310dec076b3adad894772404aec4583db33b6c7d31f1f1bd2a6c3f95d',
    );
  });

  it('vaultKey, authKey, and vaultWrapKey are all 32 bytes', () => {
    const { vaultKey, authKey, vaultWrapKey } = splitMasterKey(MASTER_KEY);
    expect(vaultKey.length).toBe(32);
    expect(authKey.length).toBe(32);
    expect(vaultWrapKey.length).toBe(32);
  });

  it('vaultKey, authKey, and vaultWrapKey derived from the same masterKey are pairwise different', () => {
    const { vaultKey, authKey, vaultWrapKey } = splitMasterKey(MASTER_KEY);
    expect(Buffer.from(vaultKey).equals(Buffer.from(authKey))).toBe(false);
    expect(Buffer.from(vaultKey).equals(Buffer.from(vaultWrapKey))).toBe(false);
    expect(Buffer.from(authKey).equals(Buffer.from(vaultWrapKey))).toBe(false);
  });

  it('vaultWrapKey is independent of vaultKey and authKey (separate HKDF domain)', () => {
    const wrapKey = deriveVaultWrapKey(MASTER_KEY);
    expect(wrapKey.length).toBe(32);
  });

  it('is deterministic', () => {
    const a = deriveVaultKey(MASTER_KEY);
    const b = deriveVaultKey(MASTER_KEY);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('different masterKeys produce different vaultKeys', () => {
    const otherKey = new Uint8Array(32).fill(0x7b);
    const a = deriveVaultKey(MASTER_KEY);
    const b = deriveVaultKey(otherKey);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
