import { describe, expect, it } from 'vitest';
import { DecryptionError } from './aesGcm.js';
import { unwrapVaultKey, wrapVaultKey } from './keyWrap.js';

const VAULT_KEY = new Uint8Array(32).fill(0xab);
const USERNAME = 'alice';

describe('vaultKey wrap/unwrap', () => {
  it('round-trips under a password-derived wrapping key', () => {
    const wrapKey = new Uint8Array(32).fill(0x11);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USERNAME);
    const unwrapped = unwrapVaultKey(wrapped, wrapKey, USERNAME);
    expect(Buffer.from(unwrapped).equals(Buffer.from(VAULT_KEY))).toBe(true);
  });

  it('round-trips under a recovery key', () => {
    const recoveryKey = new Uint8Array(32).fill(0x22);
    const wrapped = wrapVaultKey(VAULT_KEY, recoveryKey, USERNAME);
    const unwrapped = unwrapVaultKey(wrapped, recoveryKey, USERNAME);
    expect(Buffer.from(unwrapped).equals(Buffer.from(VAULT_KEY))).toBe(true);
  });

  it('password-wrapped and recovery-wrapped copies of the same vaultKey both unwrap correctly', () => {
    const passwordKey = new Uint8Array(32).fill(0x33);
    const recoveryKey = new Uint8Array(32).fill(0x44);
    const wrappedByPassword = wrapVaultKey(VAULT_KEY, passwordKey, USERNAME);
    const wrappedByRecovery = wrapVaultKey(VAULT_KEY, recoveryKey, USERNAME);

    expect(
      Buffer.from(unwrapVaultKey(wrappedByPassword, passwordKey, USERNAME)).equals(
        Buffer.from(VAULT_KEY),
      ),
    ).toBe(true);
    expect(
      Buffer.from(unwrapVaultKey(wrappedByRecovery, recoveryKey, USERNAME)).equals(
        Buffer.from(VAULT_KEY),
      ),
    ).toBe(true);
  });

  it('fails to unwrap with the wrong wrapping key', () => {
    const wrapKey = new Uint8Array(32).fill(0x55);
    const wrongKey = new Uint8Array(32).fill(0x66);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USERNAME);
    expect(() => unwrapVaultKey(wrapped, wrongKey, USERNAME)).toThrow(DecryptionError);
  });

  it('fails to unwrap when username AAD does not match (wrong account)', () => {
    const wrapKey = new Uint8Array(32).fill(0x77);
    const wrapped = wrapVaultKey(VAULT_KEY, wrapKey, USERNAME);
    expect(() => unwrapVaultKey(wrapped, wrapKey, 'bob')).toThrow(DecryptionError);
  });
});
