import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Android Keystore-backed wrap/unwrap for the cached vaultKey, per
 * SCREENS_UX.md "Native module needs" #1. The Keystore key is generated
 * with setUserAuthenticationRequired(true), so `unwrapKey` triggers a
 * BiometricPrompt natively and only resolves after successful biometric
 * auth — this is what lets biometric unlock gate access to the cached
 * encrypted vault blob (decision #7).
 *
 * `plaintextBase64`/the returned wrapped value are base64 — see
 * NativeArgon2.ts's note on why binary crosses the bridge as base64.
 */
export interface Spec extends TurboModule {
  /**
   * Ensures a hardware-backed Keystore key named `keyAlias` exists,
   * generating one with setUserAuthenticationRequired(true) if absent.
   * Idempotent — safe to call on every app start.
   */
  ensureKeyExists(keyAlias: string): Promise<void>;

  /**
   * Encrypts `plaintextBase64` under the named Keystore key — also
   * triggers a BiometricPrompt natively. setUserAuthenticationRequired(true)
   * gates every use of the key, encrypt included, not just decrypt (the
   * initial spec comment here was wrong about that — corrected after
   * verifying Android Keystore's actual semantics).
   */
  wrapKey(keyAlias: string, plaintextBase64: string, promptTitle: string): Promise<string>;

  /**
   * Decrypts `wrappedBase64` under the named Keystore key — triggers a
   * BiometricPrompt natively (the key requires user authentication to
   * use). Rejects if the prompt is cancelled or biometric auth fails.
   */
  unwrapKey(keyAlias: string, wrappedBase64: string, promptTitle: string): Promise<string>;

  /** Deletes the named Keystore key (e.g. on logout / "forget this device"). */
  deleteKey(keyAlias: string): Promise<void>;

  /** Whether biometric hardware is present and the user has enrolled at least one biometric. */
  isBiometricAvailable(): Promise<boolean>;

  /**
   * Plain on-disk key-value storage (SharedPreferences), for values that
   * are themselves already ciphertext (the wrapped vaultKey blob, session
   * token) or non-sensitive (settings). NOT a secrecy boundary by itself —
   * callers are responsible for wrapping anything sensitive via
   * wrapKey/unwrapKey before storing it here. Separate from the Keystore
   * key material itself, which Android's Keystore never exposes to app
   * code at all.
   */
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeKeystore');
