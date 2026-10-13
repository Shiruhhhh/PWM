# PWM — Crypto Core Spec (v1)

Status: finalized for v1 implementation. Changes here require bumping version fields below, not silent edits.

## 1. Master password → keys

Argon2id, single run per login/unlock:
- Memory: 64 MiB (65536 KB)
- Iterations: 3
- Parallelism: 4
- Output: 32 bytes
- Salt: 16 bytes, random per user, generated at registration, stored server-side (not secret, needed pre-auth)

Output (`masterKey`, 32 bytes) fed into **HKDF-SHA256** to derive two independent subkeys, domain-separated by `info` string — never reuse masterKey directly for both purposes:

- `vaultKey` (32 bytes) — `HKDF(masterKey, info="PWM-vault-key-v1")` — encrypts/decrypts vault blob
- `authKey` (32 bytes) — `HKDF(masterKey, info="PWM-auth-key-v1")` — login proof only, never touches ciphertext

## 2. Server-side auth verification

Server never stores `authKey` directly. Stores `Argon2id(authKey, server_salt)` (second cheap-ish pass, server_salt random per user, separate from client-side salt). Login: client sends `authKey` over mTLS, server re-hashes and compares.

## 3. Vault blob encryption

AES-256-GCM.
- Nonce: 12 bytes, cryptographically random, fresh on every encryption — never reused under same key.
- AAD: `userId || blobFormatVersion` — binds ciphertext to context.
- Wire/storage format: `cryptoSchemeVersion(1 byte) || nonce(12 bytes) || ciphertext || authTag(16 bytes)`

## 4. Vault blob format (pre-encryption, JSON)

```json
{
  "version": 1,
  "entries": [
    {
      "id": "uuid",
      "title": "",
      "username": "",
      "password": "",
      "url": "",
      "notes": "",
      "createdAt": "",
      "updatedAt": ""
    }
  ]
}
```
Whole blob encrypted as single unit (v1 — whole-vault sync model).

## 5. Recovery key

- 32 random bytes generated at setup, shown once as 24-word mnemonic (BIP39 wordlist) or base58 string.
- User saves it themselves — app never stores plaintext or auto-backs it up.
- `vaultKey` wrapped twice (both wrapped copies safe to store server-side):
  - `wrappedByPassword = AES-256-GCM-wrap(vaultKey, key=HKDF(masterKey, "PWM-vault-wrap-key-v1"))`
  - `wrappedByRecovery = AES-256-GCM-wrap(vaultKey, key=recoveryKey)`
- Recovery flow: enter recovery key → unwrap `vaultKey` → set new master password → rewrap under new Argon2id-derived key → push updated `wrappedByPassword` + new salt/KDF params.

**Addenda found during Phase 1/2 implementation (see `docs/DECISIONS.md` #16):**
- The wrap key above is `HKDF(masterKey, "PWM-vault-wrap-key-v1")` — a distinct subkey
  under its own domain-separated info string, NOT `HKDF(masterKey, "PWM-vault-key-v1")`
  (that string derives `vaultKey` itself in §1 — reusing it here would wrap `vaultKey`
  under itself, circular).
- AAD for both wrap operations is the account's `username` (UTF-8 bytes), as defense in
  depth binding a wrapped key to its account. Not `userId`: per `SCREENS_UX.md`'s setup
  flow, wrapping happens client-side *before* `POST /register` is called, so no
  server-assigned `userId` exists yet at wrap time — only the client-chosen `username`
  is available. (The vault blob's own AAD in §3, `userId || blobFormatVersion`, is
  unaffected — that encryption happens after registration, when `userId` is known.)

## 6. Biometric unlock (Android)

- Android Keystore generates hardware-backed AES key, `setUserAuthenticationRequired(true)`.
- First unlock after master password entry: wrap `vaultKey` with Keystore key, store wrapped copy in encrypted local disk cache (see decision #5).
- Later app opens: BiometricPrompt → unwrap `vaultKey` via Keystore → decrypt cached vault blob. Master password not needed again until Keystore key invalidated (biometric enrollment change, uninstall).

## 7. Password change flow

1. Derive new `masterKey'` via Argon2id with new password (new random client-side salt).
2. HKDF split → new `vaultKey-wrap-key'`, new `authKey'`.
3. Decrypt current vault blob with existing `vaultKey` (vaultKey itself does not rotate — only its wrapping).
4. Rewrap `vaultKey` under new derived key → `wrappedByPassword'`.
5. Push to server: new salt, new KDF params (if changed), new auth hash (from `authKey'`), new `wrappedByPassword'` — single atomic transaction. Old values retained until write confirmed; rollback on any failure mid-write.

## 8. Versioning fields

- `kdfParams` (algorithm, memory, iterations, parallelism, client salt) — per-user, server-side, required pre-derivation.
- `blobFormatVersion` — inside decrypted JSON, enables entry-structure migrations.
- `cryptoSchemeVersion` — 1-byte prefix on encrypted blob, allows future cipher swap while old data stays decryptable under its original scheme.

## Non-negotiable invariants

- Master password and `vaultKey` never leave the client in any form.
- GCM nonce never reused under the same key — always fresh random 12 bytes.
- `authKey` and `vaultKey` are cryptographically independent (HKDF domain separation) — compromising one must not reveal the other.
- Server only ever sees: auth hash, salts, KDF params, wrapped vaultKey copies, encrypted blob. Never plaintext secrets.
