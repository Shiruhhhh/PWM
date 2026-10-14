import {
  nativeStorage,
  wrapWithKeystore,
  unwrapWithKeystore,
  ensureVaultKeystoreKeyExists,
} from '../native/keystore';

/**
 * Disk-cached (Keystore-wrapped) copy of vaultKey + session token, per
 * CRYPTO_SPEC.md §6 / SCREENS_UX.md "App lifecycle" #1 -- lets biometric
 * unlock resume a session without re-entering the master password.
 */

const WRAPPED_VAULT_KEY_STORAGE_KEY = 'pwm_cached_wrapped_vault_key';
const SESSION_TOKEN_STORAGE_KEY = 'pwm_cached_session_token';
const USER_ID_STORAGE_KEY = 'pwm_cached_user_id';
const USERNAME_STORAGE_KEY = 'pwm_cached_username';

export interface CachedSession {
  vaultKey: Uint8Array;
  sessionToken: string;
  userId: string;
  username: string;
}

/** Called right after a successful /login or /register+/login, per SCREENS_UX.md §6. */
export async function cacheSessionForBiometricUnlock(
  session: CachedSession,
  promptTitle: string,
): Promise<void> {
  await ensureVaultKeystoreKeyExists();
  const wrappedVaultKeyBase64 = await wrapWithKeystore(session.vaultKey, promptTitle);

  await Promise.all([
    nativeStorage.setItem(WRAPPED_VAULT_KEY_STORAGE_KEY, wrappedVaultKeyBase64),
    nativeStorage.setItem(SESSION_TOKEN_STORAGE_KEY, session.sessionToken),
    nativeStorage.setItem(USER_ID_STORAGE_KEY, session.userId),
    nativeStorage.setItem(USERNAME_STORAGE_KEY, session.username),
  ]);
}

/**
 * Cold-start resume: BiometricPrompt -> unwrap cached vaultKey -> resume
 * stored session (no /login call, per the rolling-TTL session model).
 * Returns null if there's nothing cached (first run, or cache was cleared).
 */
export async function loadCachedSession(promptTitle: string): Promise<CachedSession | null> {
  const [wrappedVaultKeyBase64, sessionToken, userId, username] = await Promise.all([
    nativeStorage.getItem(WRAPPED_VAULT_KEY_STORAGE_KEY),
    nativeStorage.getItem(SESSION_TOKEN_STORAGE_KEY),
    nativeStorage.getItem(USER_ID_STORAGE_KEY),
    nativeStorage.getItem(USERNAME_STORAGE_KEY),
  ]);

  if (!wrappedVaultKeyBase64 || !sessionToken || !userId || !username) {
    return null;
  }

  const vaultKey = await unwrapWithKeystore(wrappedVaultKeyBase64, promptTitle);
  return { vaultKey, sessionToken, userId, username };
}

/** Logout / "forget this device" -- clears the cache (does not revoke server-side cert/session, caller does that separately). */
export async function clearCachedSession(): Promise<void> {
  await Promise.all([
    nativeStorage.removeItem(WRAPPED_VAULT_KEY_STORAGE_KEY),
    nativeStorage.removeItem(SESSION_TOKEN_STORAGE_KEY),
    nativeStorage.removeItem(USER_ID_STORAGE_KEY),
    nativeStorage.removeItem(USERNAME_STORAGE_KEY),
  ]);
}
