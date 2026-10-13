import { describe, expect, it } from 'vitest';
import { buildVaultBlobAad } from './crypto/aad.js';
import { decrypt, encrypt } from './crypto/aesGcm.js';
import { unwrapVaultKey, wrapVaultKey } from './crypto/keyWrap.js';
import { deriveMasterKey } from './kdf/argon2.js';
import { splitMasterKey } from './kdf/hkdf.js';
import { generateRecoveryKey } from './recovery/recoveryKey.js';
import { parseVaultBlob, VAULT_BLOB_FORMAT_VERSION } from './schema/vaultBlob.js';

/**
 * Full crypto-core lifecycle, matching CRYPTO_SPEC.md end to end:
 * password -> masterKey -> {vaultKey, authKey} -> wrap vaultKey two ways
 * -> encrypt vault blob -> decrypt via either unwrap path.
 */
describe('crypto-core lifecycle', () => {
  it('registration + password-unlock + recovery-unlock all reach the same plaintext vault', async () => {
    const userId = 'user-e2e-test';
    const clientSalt = new Uint8Array(16).fill(0x01);
    const password = "it's a secret to everybody";

    // Registration
    const masterKey = await deriveMasterKey(password, clientSalt);
    const { vaultKey, authKey, vaultWrapKey } = splitMasterKey(masterKey);
    expect(authKey.length).toBe(32);

    const recoveryKey = generateRecoveryKey();
    const wrappedByPassword = wrapVaultKey(vaultKey, vaultWrapKey, userId);
    const wrappedByRecovery = wrapVaultKey(vaultKey, recoveryKey, userId);

    const blob = parseVaultBlob({
      version: VAULT_BLOB_FORMAT_VERSION,
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000000',
          title: 'Bank',
          username: 'alice',
          password: 'correct-horse-battery-staple',
          url: 'https://bank.example',
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const plaintext = new TextEncoder().encode(JSON.stringify(blob));
    const aad = buildVaultBlobAad(userId, blob.version);
    const encryptedBlob = encrypt(vaultKey, plaintext, aad);

    // Password-unlock path
    const masterKey2 = await deriveMasterKey(password, clientSalt);
    const { vaultWrapKey: vaultWrapKeyViaPassword } = splitMasterKey(masterKey2);
    const unwrappedViaPassword = unwrapVaultKey(wrappedByPassword, vaultWrapKeyViaPassword, userId);
    const decryptedViaPassword = decrypt(unwrappedViaPassword, encryptedBlob, aad);
    expect(parseVaultBlob(JSON.parse(new TextDecoder().decode(decryptedViaPassword)))).toEqual(
      blob,
    );

    // Recovery-unlock path
    const unwrappedViaRecovery = unwrapVaultKey(wrappedByRecovery, recoveryKey, userId);
    const decryptedViaRecovery = decrypt(unwrappedViaRecovery, encryptedBlob, aad);
    expect(parseVaultBlob(JSON.parse(new TextDecoder().decode(decryptedViaRecovery)))).toEqual(
      blob,
    );
  });
});
