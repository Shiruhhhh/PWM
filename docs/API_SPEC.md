# PWM — API Spec (v1)

**Two Caddy listeners** on `pwm-app`, both pointing at the same Fastify app (see
`docs/DECISIONS.md` #22, `docs/PROXMOX_NETWORK.md`):

- **LAN/VPN-only listener** — firewalled to the OpenVPN subnet / local LAN, never
  port-forwarded on the router. Hosts exactly `POST /register` and `POST /cert/initial` —
  the only two endpoints a brand-new, cert-less device can ever reach. Plain TLS here, no
  client cert required (there isn't one yet).
- **Port 443, public, full mTLS `require_and_verify`** — unauthenticated TLS handshakes
  never reach app code. Hosts everything else: `/login`, `/vault`, `/password-change`,
  `/cert/renew`, `/cert/revoke`, `/recovery/*`, `/admin/*`. Server additionally issues
  session tokens for per-user auth on top of mTLS (mTLS proves "a trusted device,"
  session proves "which user, currently logged in").

These are real separate TCP listeners/bind addresses, not a path-based rule on one
listener — client-cert verification happens at the TLS layer, before Caddy can route by
HTTP path, so a single listener has no way to carve out a per-route exception.

## Data model

**users**: id, username, client_salt, kdf_params(json), server_salt, auth_hash, wrapped_vault_key_password, wrapped_vault_key_recovery, is_admin(bool), created_at

**vault_blobs**: user_id, encrypted_blob, revision(int), blob_format_version, updated_at

**sessions**: token, user_id, created_at, expires_at, last_used_at

**client_certs**: id, user_id, cert_cn, fingerprint, issued_at, expires_at, revoked(bool)

**server_config**: a single-row key/value table (or similar) holding `registration_open` (bool, default `true`) — see `docs/DECISIONS.md` #22.

## Endpoints

### `GET /login/params?username=`
No session required — not secret, needed before client can even compute `authHash`. Matches Bitwarden's own prelogin pattern.
- Returns: `{ clientSalt, kdfParams }`
- Same generic response/error shape regardless of whether username exists — prevents enumeration.

### `POST /register` (LAN/VPN-only listener)
Body: `{ username, clientSalt, kdfParams, authHash, wrappedVaultKeyPassword, wrappedVaultKeyRecovery }`
- Only reachable on the LAN/VPN-only listener, per `docs/DECISIONS.md` #22 — never
  exposed on the public mTLS listener.
- Gated by the `registrationOpen` flag (server_config, default `true`) — rejects with a
  generic `403` if closed. Togglable via `PATCH /admin/registration`.
- Server generates `serverSalt`, computes `Argon2id(authHash, serverSalt)`, stores result (never stores raw `authHash`).
- Rejects if username taken.
- **First registered user ever (`userCount === 0` at insert time) gets `is_admin = true`
  automatically.** Every later registration defaults `is_admin = false`. No hardcoded
  admin account, no bootstrap credential — see `docs/DECISIONS.md` #22.
- **Auto-logs in on success** (removes the need for `/login` to ever exist on the
  LAN-only listener). Returns the same shape `POST /login` returns:
  `{ sessionToken, expiresAt, userId, wrappedVaultKeyPassword }`.

### `POST /login` (public mTLS listener only)
Body: `{ username, authHash }`
- Never exposed on the LAN-only listener — it only ever serves devices that already have
  a client cert (a brand-new device gets its session via `/register`'s auto-login
  instead). See `docs/DECISIONS.md` #22.
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
- Returns: `{ newCert, certId }`. `certId` (the new `client_certs` row's id) is required
  so the device can later call `/cert/revoke` on its own cert (e.g. "forget this device"
  in SettingsScreen) — originally omitted, found and fixed during Phase 5 mobile
  implementation, see `docs/DECISIONS.md`.
- Logs rotation in `client_certs`; old cert kept active for grace period until new one confirmed working, then revoked.

### `POST /cert/revoke` (session required)
Body: `{ certId }`
- Marks cert revoked in DB.
- Pushes revocation to CA signing LXC's CRL.
- Use case: "lost my phone" button in SettingsScreen.

### `POST /cert/initial` (LAN/VPN-only listener, session required, no existing-cert check)
Body: `{ csr, deviceCn }`
- Only reachable on the LAN/VPN-only listener, alongside `/register` — per
  `docs/DECISIONS.md` #22. Issues a brand-new device's *first* client cert; deliberately
  skips the "must already have a valid cert" check `/cert/renew` does, since there isn't
  one yet.
- `deviceCn` is required here (unlike `/cert/renew`, which reuses the existing cert row's
  stored `certCn` — there's no prior row to read a CN from yet). The client picks one (a
  random device identifier) and it must match the CSR's own subject CN —
  `services/ca`'s `validateCsrSubjectCn` enforces that.
- Session required (from `/register`'s auto-login). Forwards CSR to CA signing LXC, same
  signing flow `/cert/renew` reuses.
- Returns: `{ cert, certId }`
- After this call succeeds and the cert is installed, the device uses the public mTLS
  listener (port 443) for everything from then on — no further LAN/VPN requirement.

## Admin endpoints (public mTLS listener, `is_admin` required)

Per `docs/DECISIONS.md` #22: no hardcoded/default admin account. The first registered
user (`userCount === 0` at `/register` time) becomes admin automatically; every
`/admin/*` route additionally requires `is_admin = true` on the session's user (on top of
the valid session + valid mTLS cert the listener already enforces) — non-admin
authenticated users get a generic `403`. No endpoint lets an admin create an account on
someone else's behalf; self-registration (gated by `registrationOpen`) is the only
account-creation path.

### `PATCH /admin/registration`
Body: `{ open: boolean }`
- Toggles `registrationOpen`.

### `GET /admin/users`
- Returns: `{ users: [{ id, username, createdAt, certCount, isAdmin }] }`

### `POST /admin/certs/:certId/revoke`
- Admin-triggered device revoke — same effect as a user revoking their own device via
  SettingsScreen's `/cert/revoke`, for the "lost someone else's phone and they're not
  around" case. Not scoped to the admin's own `userId` (unlike the user-facing
  `/cert/revoke`, which only allows revoking the caller's own certs).

### `PATCH /admin/users/:id/admin`
Body: `{ isAdmin: boolean }`
- Promotes (or demotes) another user's admin status. The only path for granting admin
  after the first user; no other bootstrap mechanism exists by design.

## App update endpoints (public mTLS listener, session required)

Per `TASKS.md` Phase 7 (in-app update mechanism). Not admin-gated — any authenticated
user can check for and download an update, same as they can already run/reinstall the
same APK themselves. Populated by `scripts/deploy-apk.sh`, not an upload API — see
`docs/DEPLOY.md` "Releasing an app update".

### `GET /app/version`
- Returns: `{ versionCode: number, versionName: string }`, read from `version.json` in
  `APP_RELEASES_DIR` (env var, default `/etc/pwm-app-releases`).

### `GET /app/apk`
- Streams `app-release.apk` from the same directory, `content-type:
  application/vnd.android.package-archive`.

## Session TTL policy

- Rolling 90-day TTL. Every authenticated request extends `expires_at` to `now() + 90 days` and bumps `last_used_at` — session only expires after 90 days of zero activity, not from a fixed login timestamp.
- Session token stored device-side in the same Keystore-backed encrypted storage as the wrapped `vaultKey` (per SCREENS_UX.md). Biometric unlock decrypts both together — biometric success resumes the server session with no master password needed, as long as the stored session hasn't actually expired server-side.
- Biometric failure handling (device-side, not server-side): after 3 consecutive biometric failures, app falls back to requiring master password entry (full `/login` call, new session issued). This is a client-side policy — see SCREENS_UX.md — the server has no concept of "biometric attempt count," it only ever sees either a still-valid session token or a fresh `/login`.
- Manual revocation remains the kill switch for a lost/stolen device: `/cert/revoke` + a corresponding session-revoke (delete the session row) exposed via the "manage devices" UI in SettingsScreen.

## Rate limiting

Applied at Fastify middleware (`@fastify/rate-limit`) and/or Caddy:
- `/login`, `/register`, `/login/params`, `/recovery/wrapped-key`, `/recovery/password-change` — strict per-IP + per-username limits. These are the only pre-session-token endpoints, primary brute-force targets. `/register`'s LAN-only placement reduces exposure but isn't a substitute for rate limiting — anyone on the LAN/VPN is still a Fastify-level untrusted caller until they've actually registered.

## Error handling conventions

- Never reveal whether a username exists, on any pre-auth endpoint — identical generic error either way.
- All session-required endpoints return `401` uniformly on missing/expired/invalid session, no further detail.
- `409` on revision conflict is the only endpoint-specific structured error exposed to client logic (needed for sync retry).
- All `/admin/*` routes return a generic `403` for an authenticated-but-non-admin user — don't leak that admin routes exist beyond the `403` itself.
- `/register` returns a generic `403` when `registrationOpen` is `false` — distinct from the username-taken `409`, since a closed-registration rejection isn't an enumeration risk (it says nothing about any particular username).

## Out of scope for v1

- Sharing/multi-user vault access — not needed, each account fully isolated (per project scope decision).
- Per-item sync/CRDT merge — whole-blob sync only, last-write-wins on conflict.
