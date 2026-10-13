import { describe, expect, it } from 'vitest';
import { DecryptionError } from './aesGcm.js';
import { unwrapVaultKey, wrapVaultKey } from './keyWrap.js';

const VAULT_KEY = new Uint8Array(32).fill(0xab);
const USER_ID = 'user-123';

describe('vaultKey wrap/unwrap', () => {
  it('round-trips under a password-derived wrapping key', () => {
    const wrapKey = new Uint8Array(32).fill(0x11);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USER_ID);
    const unwrapped = unwrapVaultKey(wrapped, wrapKey, USER_ID);
    expect(Buffer.from(unwrapped).equals(Buffer.from(VAULT_KEY))).toBe(true);
  });

  it('round-trips under a recovery key', () => {
    const recoveryKey = new Uint8Array(32).fill(0x22);
    const wrapped = wrapVaultKey(VAULT_KEY, recoveryKey, USER_ID);
    const unwrapped = unwrapVaultKey(wrapped, recoveryKey, USER_ID);
    expect(Buffer.from(unwrapped).equals(Buffer.from(VAULT_KEY))).toBe(true);
  });

  it('password-wrapped and recovery-wrapped copies of the same vaultKey both unwrap correctly', () => {
    const passwordKey = new Uint8Array(32).fill(0x33);
    const recoveryKey = new Uint8Array(32).fill(0x44);
    const wrappedByPassword = wrapVaultKey(VAULT_KEY, passwordKey, USER_ID);
    const wrappedByRecovery = wrapVaultKey(VAULT_KEY, recoveryKey, USER_ID);

    expect(
      Buffer.from(unwrapVaultKey(wrappedByPassword, passwordKey, USER_ID)).equals(
        Buffer.from(VAULT_KEY),
      ),
    ).toBe(true);
    expect(
      Buffer.from(unwrapVaultKey(wrappedByRecovery, recoveryKey, USER_ID)).equals(
        Buffer.from(VAULT_KEY),
      ),
    ).toBe(true);
  });

  it('fails to unwrap with the wrong wrapping key', () => {
    const wrapKey = new Uint8Array(32).fill(0x55);
    const wrongKey = new Uint8Array(32).fill(0x66);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USER_ID);
    expect(() => unwrapVaultKey(wrapped, wrongKey, USER_ID)).toThrow(DecryptionError);
  });

  it('fails to unwrap when userId AAD does not match (wrong account)', () => {
    const wrapKey = new Uint8Array(32).fill(0x77);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USER_ID);
    expect(() => unwrapVaultKey(wrapped, wrapKey, 'other-user')).toThrow(DecryptionError);
  });
});
