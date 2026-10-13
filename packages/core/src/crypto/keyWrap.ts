import { decrypt, encrypt } from './aesGcm.js';

/**
 * vaultKey wrap/unwrap per CRYPTO_SPEC.md §5. Both wrapped copies
 * (wrappedByPassword, wrappedByRecovery) are safe to store server-side.
 *
 * AAD is username (not userId) — not specified by CRYPTO_SPEC.md's
 * original text, applied here as defense in depth, binding a wrapped
 * key to the account it belongs to so a copy-pasted wrapped-key blob
 * can't be swapped onto another account. username, not userId, because
 * per SCREENS_UX.md's setup flow, wrapping happens client-side BEFORE
 * /register is called — no server-assigned userId exists yet at wrap
 * time, only the client-chosen username. See docs/CRYPTO_SPEC.md §5
 * addendum and docs/DECISIONS.md #16.
 */
export function wrapVaultKey(
  vaultKey: Uint8Array,
  wrappingKey: Uint8Array,
  username: string,
): Uint8Array {
  const aad = new TextEncoder().encode(username);
  return encrypt(wrappingKey, vaultKey, aad);
}

export function unwrapVaultKey(
  wrapped: Uint8Array,
  wrappingKey: Uint8Array,
  username: string,
): Uint8Array {
  const aad = new TextEncoder().encode(username);
  return decrypt(wrappingKey, wrapped, aad);
}
