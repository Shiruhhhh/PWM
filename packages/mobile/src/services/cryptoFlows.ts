import {
  ARGON2ID_PARAMS,
  CLIENT_SALT_LENGTH_BYTES,
  splitMasterKey,
  wrapVaultKey,
  unwrapVaultKey,
  generateRecoveryKey,
  recoveryKeyToMnemonic,
  mnemonicToRecoveryKey,
  encrypt,
  decrypt,
  buildVaultBlobAad,
  parseVaultBlob,
  VAULT_BLOB_FORMAT_VERSION,
  type KdfParams,
  type VaultBlob,
} from '@pwm/core';
import { utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils.js';
import { nativeArgon2Hash } from '../native/argon2';
import { bytesToBase64, base64ToBytes } from '../native/base64';

/**
 * Orchestrates the crypto steps per CRYPTO_SPEC.md, wiring packages/core's
 * pure functions to the native Argon2id module (Hermes can't run the
 * Node `argon2` package core uses server-side -- see docs/DECISIONS.md).
 * Each function here maps 1:1 to a step in CRYPTO_SPEC.md so the mapping
 * stays auditable against the spec.
 */

function randomClientSalt(): Uint8Array {
  const salt = new Uint8Array(CLIENT_SALT_LENGTH_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

export interface MasterKeyDerivation {
  masterKey: Uint8Array;
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  vaultWrapKey: Uint8Array;
}

/** CRYPTO_SPEC.md §1: Argon2id(password, clientSalt) -> masterKey -> HKDF split. */
export async function deriveKeysFromPassword(
  password: string,
  clientSalt: Uint8Array,
  kdfParams: KdfParams,
): Promise<MasterKeyDerivation> {
  const masterKey = await nativeArgon2Hash(password, clientSalt, {
    algorithm: 'argon2id',
    memoryKiB: kdfParams.memoryKiB,
    iterations: kdfParams.iterations,
    parallelism: kdfParams.parallelism,
    hashLength: 32,
  });
  const { vaultKey, authKey, vaultWrapKey } = splitMasterKey(masterKey);
  return { masterKey, vaultKey, authKey, vaultWrapKey };
}

export interface SetupResult {
  username: string;
  clientSalt: Uint8Array;
  kdfParams: KdfParams;
  authKeyBase64: string;
  wrappedVaultKeyPasswordBase64: string;
  wrappedVaultKeyRecoveryBase64: string;
  vaultKey: Uint8Array;
  recoveryMnemonic: string;
}

/**
 * SCREENS_UX.md SetupScreen step 5: derive keys, wrap vaultKey under
 * both the password-derived key and the recovery key, ready for
 * POST /register. Returns the recovery mnemonic for the
 * RecoveryDisplayStep -- caller is responsible for clearing it from
 * memory/state after the blind-confirm step succeeds (per spec, this
 * module never persists it).
 */
export async function runSetupKeyDerivation(
  username: string,
  password: string,
): Promise<SetupResult> {
  const clientSalt = randomClientSalt();
  const kdfParams: KdfParams = {
    algorithm: 'argon2id',
    memoryKiB: ARGON2ID_PARAMS.memoryKiB,
    iterations: ARGON2ID_PARAMS.iterations,
    parallelism: ARGON2ID_PARAMS.parallelism,
  };

  const { vaultKey, authKey, vaultWrapKey } = await deriveKeysFromPassword(
    password,
    clientSalt,
    kdfParams,
  );

  const recoveryKey = generateRecoveryKey();
  const recoveryMnemonic = recoveryKeyToMnemonic(recoveryKey);

  const wrappedByPassword = wrapVaultKey(vaultKey, vaultWrapKey, username);
  const wrappedByRecovery = wrapVaultKey(vaultKey, recoveryKey, username);

  return {
    username,
    clientSalt,
    kdfParams,
    authKeyBase64: bytesToBase64(authKey),
    wrappedVaultKeyPasswordBase64: bytesToBase64(wrappedByPassword),
    wrappedVaultKeyRecoveryBase64: bytesToBase64(wrappedByRecovery),
    vaultKey,
    recoveryMnemonic,
  };
}

/**
 * LoginScreen: unwraps vaultKey using the vaultWrapKey already derived
 * (via deriveKeysFromPassword) and the wrappedVaultKeyPassword returned
 * by POST /login. Split from key derivation itself because the real
 * login sequence is derive -> call /login with authKey -> THEN unwrap
 * with what /login's response gives back (see docs/DECISIONS.md #19 --
 * /login's response, not /login/params, is what carries both
 * wrappedVaultKeyPassword and userId).
 */
export function unwrapVaultKeyFromPassword(
  username: string,
  vaultWrapKey: Uint8Array,
  wrappedVaultKeyPasswordBase64: string,
): Uint8Array {
  return unwrapVaultKey(base64ToBytes(wrappedVaultKeyPasswordBase64), vaultWrapKey, username);
}

/**
 * Convenience wrapper combining deriveKeysFromPassword + unwrap in one
 * call, for callers (tests, RecoveryScreen's password-reset step) that
 * already have clientSalt/kdfParams/wrappedVaultKeyPassword on hand
 * together and don't need the intermediate authKey for a separate
 * network call.
 */
export async function runLoginKeyDerivation(
  username: string,
  password: string,
  clientSalt: Uint8Array,
  kdfParams: KdfParams,
  wrappedVaultKeyPasswordBase64: string,
): Promise<{ vaultKey: Uint8Array; authKeyBase64: string }> {
  const { authKey, vaultWrapKey } = await deriveKeysFromPassword(password, clientSalt, kdfParams);
  const vaultKey = unwrapVaultKeyFromPassword(
    username,
    vaultWrapKey,
    wrappedVaultKeyPasswordBase64,
  );
  return { vaultKey, authKeyBase64: bytesToBase64(authKey) };
}

/** RecoveryScreen: unwrap vaultKey using the recovery mnemonic instead of a password. */
export function unwrapVaultKeyFromRecovery(
  username: string,
  mnemonic: string,
  wrappedVaultKeyRecoveryBase64: string,
): Uint8Array {
  const recoveryKey = mnemonicToRecoveryKey(mnemonic);
  return unwrapVaultKey(base64ToBytes(wrappedVaultKeyRecoveryBase64), recoveryKey, username);
}

/**
 * Password-change / recovery-rewrap flow (CRYPTO_SPEC.md §7): derive a
 * fresh masterKey under a new password, rewrap the *existing* vaultKey
 * (vaultKey itself never rotates) under the new wrap key.
 */
export async function runPasswordChangeKeyDerivation(
  username: string,
  newPassword: string,
  vaultKey: Uint8Array,
): Promise<{
  newClientSalt: Uint8Array;
  newKdfParams: KdfParams;
  newAuthKeyBase64: string;
  newWrappedVaultKeyPasswordBase64: string;
}> {
  const newClientSalt = randomClientSalt();
  const newKdfParams: KdfParams = {
    algorithm: 'argon2id',
    memoryKiB: ARGON2ID_PARAMS.memoryKiB,
    iterations: ARGON2ID_PARAMS.iterations,
    parallelism: ARGON2ID_PARAMS.parallelism,
  };

  const { authKey, vaultWrapKey } = await deriveKeysFromPassword(
    newPassword,
    newClientSalt,
    newKdfParams,
  );
  const newWrappedVaultKeyPassword = wrapVaultKey(vaultKey, vaultWrapKey, username);

  return {
    newClientSalt,
    newKdfParams,
    newAuthKeyBase64: bytesToBase64(authKey),
    newWrappedVaultKeyPasswordBase64: bytesToBase64(newWrappedVaultKeyPassword),
  };
}

/** CRYPTO_SPEC.md §3/§4: decrypt + parse the vault blob fetched from GET /vault. */
export function decryptVaultBlob(
  encryptedBlobBase64: string,
  vaultKey: Uint8Array,
  userId: string,
  blobFormatVersion: number,
): VaultBlob {
  if (encryptedBlobBase64 === '') {
    // Freshly registered account -- POST /register creates an empty
    // vault_blobs row (encryptedBlob = empty bytes), per register.ts.
    return { version: VAULT_BLOB_FORMAT_VERSION, entries: [] };
  }
  const aad = buildVaultBlobAad(userId, blobFormatVersion);
  const plaintext = decrypt(vaultKey, base64ToBytes(encryptedBlobBase64), aad);
  return parseVaultBlob(JSON.parse(bytesToUtf8(plaintext)));
}

/** Encrypts a VaultBlob for PUT /vault. */
export function encryptVaultBlob(blob: VaultBlob, vaultKey: Uint8Array, userId: string): string {
  const aad = buildVaultBlobAad(userId, blob.version);
  const plaintext = utf8ToBytes(JSON.stringify(blob));
  const encrypted = encrypt(vaultKey, plaintext, aad);
  return bytesToBase64(encrypted);
}
