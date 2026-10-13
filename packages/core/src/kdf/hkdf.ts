import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Domain-separation info strings, exact per CRYPTO_SPEC.md §1.
 * Never reuse masterKey directly — always split through HKDF with these.
 */
export const VAULT_KEY_INFO = 'PWM-vault-key-v1';
export const AUTH_KEY_INFO = 'PWM-auth-key-v1';

/**
 * §5 as written wraps vaultKey under HKDF(masterKey, "PWM-vault-key-v1"),
 * which is vaultKey itself (circular — see docs/DECISIONS.md addendum).
 * Fixed by deriving a distinct wrapping key under its own domain.
 */
export const VAULT_WRAP_KEY_INFO = 'PWM-vault-wrap-key-v1';

const SUBKEY_LENGTH_BYTES = 32;

function deriveSubkey(masterKey: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, masterKey, undefined, info, SUBKEY_LENGTH_BYTES);
}

/** Derives `vaultKey` from `masterKey` — encrypts/decrypts the vault blob. */
export function deriveVaultKey(masterKey: Uint8Array): Uint8Array {
  return deriveSubkey(masterKey, VAULT_KEY_INFO);
}

/** Derives `authKey` from `masterKey` — login proof only, never touches ciphertext. */
export function deriveAuthKey(masterKey: Uint8Array): Uint8Array {
  return deriveSubkey(masterKey, AUTH_KEY_INFO);
}

/**
 * Derives the key that wraps/unwraps `vaultKey` for the password path
 * (CRYPTO_SPEC.md §5's `wrappedByPassword`). Distinct from `vaultKey`
 * itself — see VAULT_WRAP_KEY_INFO.
 */
export function deriveVaultWrapKey(masterKey: Uint8Array): Uint8Array {
  return deriveSubkey(masterKey, VAULT_WRAP_KEY_INFO);
}

/** Convenience: derives all subkeys from masterKey in one call. */
export function splitMasterKey(masterKey: Uint8Array): {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  vaultWrapKey: Uint8Array;
} {
  return {
    vaultKey: deriveVaultKey(masterKey),
    authKey: deriveAuthKey(masterKey),
    vaultWrapKey: deriveVaultWrapKey(masterKey),
  };
}
