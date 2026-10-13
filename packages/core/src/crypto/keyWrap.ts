import { decrypt, encrypt } from './aesGcm.js';

/**
 * vaultKey wrap/unwrap per CRYPTO_SPEC.md §5. Both wrapped copies
 * (wrappedByPassword, wrappedByRecovery) are safe to store server-side.
 *
 * AAD is userId — not specified by CRYPTO_SPEC.md itself, but applied here
 * as defense in depth, binding a wrapped key to the account it belongs to
 * so a copy-pasted wrapped-key blob can't be swapped onto another account.
 */
export function wrapVaultKey(
  vaultKey: Uint8Array,
  wrappingKey: Uint8Array,
  userId: string,
): Uint8Array {
  const aad = new TextEncoder().encode(userId);
  return encrypt(wrappingKey, vaultKey, aad);
}

export function unwrapVaultKey(
  wrapped: Uint8Array,
  wrappingKey: Uint8Array,
  userId: string,
): Uint8Array {
  const aad = new TextEncoder().encode(userId);
  return decrypt(wrappingKey, wrapped, aad);
}
