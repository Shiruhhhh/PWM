# PWM — API Spec (v1)

All endpoints behind Caddy with mTLS `require_and_verify` — unauthenticated TLS handshakes never reach app code. Server additionally issues session tokens for per-user auth on top of mTLS (mTLS proves "a trusted device," session proves "which user, currently logged in").

## Data model

**users**: id, username, client_salt, kdf_params(json), server_salt, auth_hash, wrapped_vault_key_password, wrapped_vault_key_recovery, created_at

**vault_blobs**: user_id, encrypted_blob, revision(int), blob_format_version, updated_at

**sessions**: token, user_id, created_at, expires_at, last_used_at

**client_certs**: id, user_id, cert_cn, fingerprint, issued_at, expires_at, revoked(bool)

## Endpoints

### `GET /login/params?username=`
No session required — not secret, needed before client can even compute `authHash`. Matches Bitwarden's own prelogin pattern.
- Returns: `{ clientSalt, kdfParams }`
- Same generic response/error shape regardless of whether username exists — prevents enumeration.

### `POST /register`
Body: `{ username, clientSalt, kdfParams, authHash, wrappedVaultKeyPassword, wrappedVaultKeyRecovery }`
- Server generates `serverSalt`, computes `Argon2id(authHash, serverSalt)`, stores result (never stores raw `authHash`).
- Rejects if username taken.
- Returns: `{ userId }`

### `POST /login`
Body: `{ username, authHash }`
- Server recomputes `Argon2id(authHash, storedServerSalt)`, constant-time compare against stored hash.
- Same generic failure response whether username missing or hash mismatch.
- On match: creates session row.
- Returns: `{ sessionToken, expiresAt, wrappedVaultKeyPassword, userId }`. `userId` is needed by
  the client for the vault blob's AAD (§3 of `CRYPTO_SPEC.md`) on every `GET /vault` decrypt —
  `POST /register` only returns it once, which breaks login on any device that didn't just
  register locally (reinstall, second device). See `docs/DECISIONS.md`.

### `GET /vault` (session required)
- Returns: `{ encryptedBlob, revision, blobFormatVersion }`

### `PUT /vault` (session required)
Body: `{ encryptedBlob, expectedRevision, blobFormatVersion }`
- `expectedRevision` mismatch → `409` + current revision (client refetches, merges, retries).
- Match → write, increment revision, update `updated_at`.

### `POST /password-change` (session required)
Body: `{ newClientSalt, newKdfParams, newAuthHash, newWrappedVaultKeyPassword }`
- Single DB transaction: new salt, kdf_params, re-hashed auth_hash, new wrapped_vault_key_password.
- Old values retained until write confirmed; rollback on any failure mid-write.
- Invalidates other active sessions (keep current one).

### `GET /recovery/wrapped-key?username=`
No session required — recovery key itself is the credential, never sent to server.
- Hard rate-limited per-IP + per-username.
- Returns: `{ wrappedVaultKeyRecovery, blobFormatVersion }`
- Client unwraps `vaultKey` locally using recovery key, then proceeds through
  `POST /recovery/password-change` (not the normal session-required `/password-change` —
  see below) with a new master password. Server has no separate recovery-verification
  step — recovery is purely a local unwrap-then-rewrap operation.

### `POST /recovery/password-change`
Body: `{ username, newClientSalt, newKdfParams, newAuthHash, newWrappedVaultKeyPassword }`
- **No session required** — added per `docs/DECISIONS.md` #20. The normal
  `POST /password-change` requires an active session, which recovery by definition doesn't
  have (that's the whole point of recovery). The client already proved possession of the
  recovery key by successfully unwrapping `wrappedVaultKeyRecovery` locally before calling
  this — same trust model `GET /recovery/wrapped-key` already accepts (server can't verify
  the unwrap happened, same as it can't verify anything else about a local-only operation).
- Hard rate-limited per-IP + per-username, same as `GET /recovery/wrapped-key`.
- Same atomic transaction as `/password-change` (new salt, kdf_params, auth hash, wrapped
  vaultKey), except it invalidates **all** sessions for the account (no "current" session
  to exempt).
- Same generic response whether the username exists or not — can't be used to enumerate
  accounts, per "Error handling conventions" below.
- Returns: `204` on success, generic `401` (same shape as other auth failures) if the
  username doesn't exist.

### `POST /cert/renew` (session required, current valid client cert)
Body: `{ csr }`
- Validates session + current cert not expired/revoked.
- Forwards CSR to CA signing LXC over internal mTLS link.
- Returns: `{ newCert }`
- Logs rotation in `client_certs`; old cert kept active for grace period until new one confirmed working, then revoked.

### `POST /cert/revoke` (session required)
Body: `{ certId }`
- Marks cert revoked in DB.
- Pushes revocation to CA signing LXC's CRL.
- Use case: "lost my phone" button in SettingsScreen.

## Session TTL policy

- Rolling 90-day TTL. Every authenticated request extends `expires_at` to `now() + 90 days` and bumps `last_used_at` — session only expires after 90 days of zero activity, not from a fixed login timestamp.
- Session token stored device-side in the same Keystore-backed encrypted storage as the wrapped `vaultKey` (per SCREENS_UX.md). Biometric unlock decrypts both together — biometric success resumes the server session with no master password needed, as long as the stored session hasn't actually expired server-side.
- Biometric failure handling (device-side, not server-side): after 3 consecutive biometric failures, app falls back to requiring master password entry (full `/login` call, new session issued). This is a client-side policy — see SCREENS_UX.md — the server has no concept of "biometric attempt count," it only ever sees either a still-valid session token or a fresh `/login`.
- Manual revocation remains the kill switch for a lost/stolen device: `/cert/revoke` + a corresponding session-revoke (delete the session row) exposed via the "manage devices" UI in SettingsScreen.

## Rate limiting

Applied at Fastify middleware (`@fastify/rate-limit`) and/or Caddy:
- `/login`, `/register`, `/login/params`, `/recovery/wrapped-key`, `/recovery/password-change` — strict per-IP + per-username limits. These are the only pre-session-token endpoints, primary brute-force targets.

## Error handling conventions

- Never reveal whether a username exists, on any pre-auth endpoint — identical generic error either way.
- All session-required endpoints return `401` uniformly on missing/expired/invalid session, no further detail.
- `409` on revision conflict is the only endpoint-specific structured error exposed to client logic (needed for sync retry).

## Out of scope for v1

- Sharing/multi-user vault access — not needed, each account fully isolated (per project scope decision).
- Per-item sync/CRDT merge — whole-blob sync only, last-write-wins on conflict.
