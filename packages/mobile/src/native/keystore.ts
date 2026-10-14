import NativeKeystore from '../../specs/NativeKeystore';
import { bytesToBase64, base64ToBytes } from './base64';

/** Keystore alias for the key that wraps the cached vaultKey, per SCREENS_UX.md. */
export const VAULT_KEY_KEYSTORE_ALIAS = 'pwm-vault-key-wrap';

export class KeyInvalidatedError extends Error {
  constructor(message = 'Keystore key invalidated (biometric enrollment changed)') {
    super(message);
    this.name = 'KeyInvalidatedError';
  }
}

export class BiometricAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BiometricAuthError';
  }
}

function mapNativeError(err: unknown): never {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'KEY_INVALIDATED') {
    throw new KeyInvalidatedError();
  }
  if (typeof code === 'string' && code.startsWith('BIOMETRIC_ERROR_')) {
    throw new BiometricAuthError(code);
  }
  throw err;
}

export async function ensureVaultKeystoreKeyExists(): Promise<void> {
  await NativeKeystore.ensureKeyExists(VAULT_KEY_KEYSTORE_ALIAS);
}

/** Encrypts `plaintext` under the Keystore key, prompting biometric auth. */
export async function wrapWithKeystore(
  plaintext: Uint8Array,
  promptTitle: string,
): Promise<string> {
  try {
    return await NativeKeystore.wrapKey(
      VAULT_KEY_KEYSTORE_ALIAS,
      bytesToBase64(plaintext),
      promptTitle,
    );
  } catch (err) {
    mapNativeError(err);
  }
}

/** Decrypts a value produced by wrapWithKeystore, prompting biometric auth. */
export async function unwrapWithKeystore(
  wrappedBase64: string,
  promptTitle: string,
): Promise<Uint8Array> {
  try {
    const plaintextBase64 = await NativeKeystore.unwrapKey(
      VAULT_KEY_KEYSTORE_ALIAS,
      wrappedBase64,
      promptTitle,
    );
    return base64ToBytes(plaintextBase64);
  } catch (err) {
    mapNativeError(err);
  }
}

export async function deleteVaultKeystoreKey(): Promise<void> {
  await NativeKeystore.deleteKey(VAULT_KEY_KEYSTORE_ALIAS);
}

export async function isBiometricAvailable(): Promise<boolean> {
  return NativeKeystore.isBiometricAvailable();
}

/** Plain on-disk storage for already-ciphertext or non-sensitive values. */
export const nativeStorage = {
  setItem: (key: string, value: string): Promise<void> => NativeKeystore.setItem(key, value),
  getItem: (key: string): Promise<string | null> => NativeKeystore.getItem(key),
  removeItem: (key: string): Promise<void> => NativeKeystore.removeItem(key),
};
