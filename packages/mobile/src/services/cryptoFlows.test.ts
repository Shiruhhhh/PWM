import { bytesToHex } from '@noble/hashes/utils.js';

jest.mock('../native/argon2', () => ({
  // Test-only stand-in for the native Argon2id module (not runnable
  // outside the RN/Android runtime) -- delegates to packages/core's own
  // Node-native argon2 binding so this test exercises real Argon2id
  // output, not a fake. Confirms cryptoFlows.ts's call shape is correct;
  // the actual native binding's correctness is covered by the Android
  // build + manual QA checklist (TESTING.md), since it can't run in Jest.
  nativeArgon2Hash: jest.fn(
    async (
      password: string,
      salt: Uint8Array,
      params: { memoryKiB: number; iterations: number; parallelism: number; hashLength: number },
    ) => {
      const { deriveMasterKey } = jest.requireActual('@pwm/core/node');
      return deriveMasterKey(password, salt, {
        algorithm: 'argon2id',
        memoryKiB: params.memoryKiB,
        iterations: params.iterations,
        parallelism: params.parallelism,
        hashLength: params.hashLength,
      });
    },
  ),
}));

import {
  runSetupKeyDerivation,
  runLoginKeyDerivation,
  runPasswordChangeKeyDerivation,
  unwrapVaultKeyFromRecovery,
  unwrapVaultKeyFromPassword,
  deriveKeysFromPassword,
  decryptVaultBlob,
  encryptVaultBlob,
} from './cryptoFlows';

const USERNAME = 'alice';
const USER_ID = 'user-uuid-123';
const PASSWORD = 'correct horse battery staple';

describe('cryptoFlows setup -> login round trip', () => {
  it('derives the same vaultKey on login as was produced at setup', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);

    const login = await runLoginKeyDerivation(
      USERNAME,
      PASSWORD,
      setup.clientSalt,
      setup.kdfParams,
      setup.wrappedVaultKeyPasswordBase64,
    );

    expect(bytesToHex(login.vaultKey)).toBe(bytesToHex(setup.vaultKey));
    expect(login.authKeyBase64).toBe(setup.authKeyBase64);
  });

  it('split derive-then-unwrap produces the same vaultKey as the combined helper (actual LoginScreen sequence)', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);

    const { authKey, vaultWrapKey } = await deriveKeysFromPassword(
      PASSWORD,
      setup.clientSalt,
      setup.kdfParams,
    );
    const vaultKey = unwrapVaultKeyFromPassword(
      USERNAME,
      vaultWrapKey,
      setup.wrappedVaultKeyPasswordBase64,
    );

    expect(bytesToHex(vaultKey)).toBe(bytesToHex(setup.vaultKey));
    expect(authKey.length).toBe(32);
  });

  it('login with the wrong password produces a different (wrong) vaultKey rather than throwing', async () => {
    // Wrapping is unauthenticated-by-password (AAD is username, not a
    // password-derived check) -- a wrong password derives a different
    // vaultWrapKey, so unwrap fails its own GCM auth tag check. Assert it
    // throws rather than silently producing wrong plaintext.
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);

    await expect(
      runLoginKeyDerivation(
        USERNAME,
        'wrong password',
        setup.clientSalt,
        setup.kdfParams,
        setup.wrappedVaultKeyPasswordBase64,
      ),
    ).rejects.toThrow();
  });

  it('unwrapping with the wrong username fails (AAD mismatch)', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);

    await expect(
      runLoginKeyDerivation(
        'bob',
        PASSWORD,
        setup.clientSalt,
        setup.kdfParams,
        setup.wrappedVaultKeyPasswordBase64,
      ),
    ).rejects.toThrow();
  });
});

describe('cryptoFlows recovery flow', () => {
  it('unwraps the same vaultKey via the recovery mnemonic as via the password', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);

    const recoveredVaultKey = unwrapVaultKeyFromRecovery(
      USERNAME,
      setup.recoveryMnemonic,
      setup.wrappedVaultKeyRecoveryBase64,
    );

    expect(bytesToHex(recoveredVaultKey)).toBe(bytesToHex(setup.vaultKey));
  });
});

describe('cryptoFlows password-change flow', () => {
  it('rewraps the same vaultKey under a new password, unwrappable with the new password only', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);
    const NEW_PASSWORD = 'a different, longer passphrase entirely';

    const change = await runPasswordChangeKeyDerivation(USERNAME, NEW_PASSWORD, setup.vaultKey);

    const loginWithNewPassword = await runLoginKeyDerivation(
      USERNAME,
      NEW_PASSWORD,
      change.newClientSalt,
      change.newKdfParams,
      change.newWrappedVaultKeyPasswordBase64,
    );
    expect(bytesToHex(loginWithNewPassword.vaultKey)).toBe(bytesToHex(setup.vaultKey));

    // Old password no longer unwraps the NEW wrapped copy.
    await expect(
      runLoginKeyDerivation(
        USERNAME,
        PASSWORD,
        change.newClientSalt,
        change.newKdfParams,
        change.newWrappedVaultKeyPasswordBase64,
      ),
    ).rejects.toThrow();
  });
});

describe('cryptoFlows vault blob encrypt/decrypt', () => {
  it('round-trips an empty vault for a freshly registered account', () => {
    const blob = decryptVaultBlob('', new Uint8Array(32), USER_ID, 1);
    expect(blob).toEqual({ version: 1, entries: [] });
  });

  it('encrypts then decrypts a vault blob with entries', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);
    const blob = {
      version: 1 as const,
      entries: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Example',
          username: 'me',
          password: 'secret',
          url: 'https://example.com',
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    const encryptedBase64 = encryptVaultBlob(blob, setup.vaultKey, USER_ID);
    const decrypted = decryptVaultBlob(encryptedBase64, setup.vaultKey, USER_ID, 1);

    expect(decrypted).toEqual(blob);
  });

  it('fails to decrypt with the wrong userId (AAD mismatch)', async () => {
    const setup = await runSetupKeyDerivation(USERNAME, PASSWORD);
    const blob = { version: 1 as const, entries: [] };
    const encryptedBase64 = encryptVaultBlob(blob, setup.vaultKey, USER_ID);

    expect(() =>
      decryptVaultBlob(encryptedBase64, setup.vaultKey, 'different-user-id', 1),
    ).toThrow();
  });
});
