# PWM — Open Decisions

Mark choice with `[x]`. Leave unchecked = not decided yet.

## Crypto / Security

### 1. Master password recovery
- [ ] Accept total data loss if forgotten (pure zero-knowledge, simplest)
- [x] Add recovery key/phrase shown once at setup (encrypts vault key separately, recoverable but slightly weaker guarantee)

Resolved: recovery key generated once, shown once, user saves it themselves (not auto-stored by app — app-side storage of an unencrypted recovery key defeats the point if device is compromised). No Discord-style auto-stored backup codes.

### 2. Password change flow
- [x] Design now (re-derive key, re-encrypt blob, atomic push, rollback on failure)
- [ ] Defer to v2 (lock master password at creation for v1)

### 3. KDF/blob format versioning
- [x] Add version field to vault blob + per-user KDF params from day one (future-proof)
- [ ] Skip for v1, hardcode params (risk: breaking change later)

### 4. Clipboard leakage after copy-to-clipboard
- [x] Auto-clear clipboard after timeout (e.g. 30s)
- [ ] No mitigation for v1

### 5. Local vault caching on device
- [ ] Memory only, never touches disk (safer, lost on app kill/reboot)
- [x] Encrypted disk cache tied to Android Keystore (better UX, more complexity)

Resolved: required by biometric unlock (#7) + idle lock (#6) choices — biometric should unlock a cached encrypted vault, not force master-password re-entry on every app restart.

### 6. Idle/lock timeout
- [x] Add auto-relock after inactivity (e.g. 2 min)
- [ ] No timeout for v1
also want it configurable on settings

### 7. Biometric unlock
- [x] Yes — BiometricPrompt gates a Keystore-wrapped key (needed for girlfriend-usability)
- [ ] No — master password only for v1

## Operational / Infra

### 8. Backup strategy
- [x] Automated encrypted off-VM backups (cron + remote/offsite copy)
- [ ] Manual/none for v1
i have a backup drive on the proxmox machine dedicated for backups

### 9. Client cert expiry/rotation process
- [x] Automatic rotation (app checks expiry on launch, renews via authenticated request before expiry — non-expiring certs rejected as bad practice, no revocation value if ever leaked)
- [ ] Document + calendar reminder before 825-day expiry
- [ ] Deal with it when it breaks

Depends on #12 (CA key needs to be reachable by a signing service for this to work automatically).

### 10. Server cert renewal
- [x] Confirm Caddy auto-renew works (Let's Encrypt)
- [ ] Self-signed, manual renewal

### 11. Monitoring/alerting
- [x] Basic uptime check / log review
- [ ] None for v1

### 12. CA private key storage
- [x] Dedicated minimal signing service, separate LXC container from main app VM — narrow API, only signs a CSR when request carries a still-valid client cert + active session, nothing else exposed. No public exposure, reachable only from app VM's internal IP. Chosen LXC over full VM for lighter footprint.
- [ ] Keep fully offline/manual (blocks automatic rotation, chosen in #9)
- [ ] Keep on app VM for convenience (risk: app VM compromise = mint new trusted certs)

Resolved as middle ground: enables #9 automatic rotation without putting CA key on the internet-facing app VM.

## Project / Open Source

### 13. Self-hoster onboarding docs
- [ ] Full step-by-step (CA gen, cert issuance, deploy, DDNS/port-forward, app install) written before/alongside v1
- [x] Minimal README, improve later

### 14. Vault blob migration strategy
- [x] Plan versioned migrations from day one
- [ ] Defer, accept breaking changes pre-v1.0

### 15. Multi-device per user
- [x] Support multiple certs per user account now (phone + future desktop)
- [ ] 1 cert = 1 device for v1, revisit later

## Deferred to v2 (explicitly out of scope for v1, not forgotten)

- [ ] Autofill (Android Autofill Framework integration)
- [ ] TOTP/2FA secondary codes stored per entry
- [ ] Custom fields per entry
- [ ] Folders/tags for organizing entries
- [ ] Desktop client (Electron, reusing `core` package)
- [ ] iOS client
- [ ] Per-item sync/merge (replacing whole-blob last-write-wins)
- [ ] Automated RN device/emulator testing in CI

## Naming / Licensing
- [x] Keep folder/repo name `PWM` (name doesn't affect CV/portfolio value — code quality and docs do)
- [ ] Rename before public push
- [x] License: MIT (simplest, most permissive, standard for this project type)
- [ ] License: Apache-2.0

### 6. Idle/lock timeout — addendum
Confirmed configurable in app settings (not a hardcoded value).

### 16. CRYPTO_SPEC.md §5 wrappedByPassword key — bug found during Phase 1 implementation
`wrappedByPassword = wrap(vaultKey, key=HKDF(masterKey, "PWM-vault-key-v1"))` as literally
written wraps `vaultKey` under itself (that HKDF info string is the same one used to derive
`vaultKey` in §1) — circular, you'd need `vaultKey` to unwrap `vaultKey`.

- [x] Fix: derive a distinct wrapping key under its own domain-separated info string,
  `HKDF(masterKey, "PWM-vault-wrap-key-v1")`, used only to wrap/unwrap `vaultKey` for the
  password path. `vaultKey` itself stays independent and never rotates (matches §7's own
  statement that only its wrapping changes on password change). Implemented in
  `packages/core/src/kdf/hkdf.ts` as `deriveVaultWrapKey` / `VAULT_WRAP_KEY_INFO`.

**Follow-up bug found during Phase 2 implementation**: the wrap/unwrap AAD (defense in
depth, not in CRYPTO_SPEC.md's original text) was initially bound to `userId`. But
`SCREENS_UX.md`'s setup flow wraps `vaultKey` client-side *before* calling `POST
/register` — no server-assigned `userId` exists yet at that point, only the
client-chosen `username`. Ordering conflict; `userId`-as-AAD is impossible at wrap time
during registration.

- [x] Fix: wrap/unwrap AAD is `username` (UTF-8 bytes), not `userId`. Implemented in
  `packages/core/src/crypto/keyWrap.ts`. The vault blob's own AAD (§3, `userId ||
  blobFormatVersion`) is unrelated and unaffected — that encryption happens after
  registration, once `userId` is known. Both changes documented in `docs/CRYPTO_SPEC.md`
  §5's addenda.

### 17. CA_SERVICE_SPEC.md's Caddy-CRL assumption — incorrect, found during Phase 2 implementation
`CA_SERVICE_SPEC.md`'s `GET /crl` section originally said "Caddy's `client_auth` can be
configured to check against a CRL file it reads locally." Verified via web search:
**stock Caddy has no such directive.** `client_auth` with `require_and_verify` only
checks that a presented cert chains to a trusted CA — it has no revocation/CRL support
built in. A third-party plugin (`caddy-revocation-validator`) adds this but requires a
custom `xcaddy` build instead of the stock Caddy image.

- [x] Fix: move revocation checking to the application layer instead of the TLS layer.
  pwm-app polls `GET /crl` from pwm-ca and caches the result; a Fastify preHandler on
  every session-required route checks the presented client cert's fingerprint against
  it (and against `client_certs.revoked` in the DB) and rejects with 401 if revoked.
  Caddy's `client_auth` stays `require_and_verify` (trusted-CA check only) — a revoked
  cert still passes the TLS handshake and gets rejected one layer up, by the app.
  Chosen over the xcaddy custom-build route to avoid adding Caddy build complexity for
  a 2-user personal deployment. Implemented in `packages/server/src/lib/*` (Phase 2),
  documented in `docs/CA_SERVICE_SPEC.md` and `docs/MONITORING.md`.

### 18. Phase 1-3 code review findings — fixed post-implementation
A code review of `packages/core`/`packages/server`/`services/ca` found 7 issues. All fixed:

- [x] **Security-critical**: `httpCaClient` (`packages/server/src/lib/caClient.ts`) sent
  requests to pwm-ca with plain `fetch` and no client certificate — despite
  `CA_SERVICE_SPEC.md` requiring mTLS for the pwm-app-to-pwm-ca link, `/cert/renew` and
  `/cert/revoke` had no actual authentication to the CA service. Fixed: `httpCaClient`
  now takes an `MtlsClientCertConfig` (cert/key/CA PEMs) and presents it via an `undici`
  `Agent` dispatcher on every request. `buildApp()` loads the PEM paths from
  `CA_CLIENT_CERT_PATH`/`CA_CLIENT_KEY_PATH`/`CA_TRUST_CERT_PATH` env vars (provisioned by
  the bootstrap runbook, never generated by app code) and throws at startup if
  `CA_SERVICE_URL` is set without them.
- [x] **Concurrency bug**: `services/ca/src/storage.ts`'s `appendRevocation` did an
  unserialized read-modify-write of `crl.json` — two concurrent `POST /revoke` calls
  could race, silently losing one revocation. Fixed: serialized through an in-process
  promise queue (sufficient since pwm-ca runs as a single systemd process, per spec).
- [x] **Concurrency bug**: `signCsr`'s cleanup unconditionally deleted the CA's shared
  `.srl` serial-number file after every sign, racing concurrent `/sign` calls and
  risking duplicate cert serials. Fixed: stopped deleting it (it's meant to persist and
  increment across signs) and serialized signing through the same in-process queue
  pattern.
- [x] Weak-key validation regex-parsed openssl's human-readable `-text` debug output —
  fragile across openssl versions/builds. Fixed: extract the CSR's public key via
  `openssl req -pubkey` and inspect it with Node's own `crypto.createPublicKey`
  (`asymmetricKeyType`/`asymmetricKeyDetails`), no text-format parsing at all.
- [x] `config.ts`'s `Number(process.env.PORT ?? 4433)` didn't catch `PORT=""` (`Number('')`
  is `0`), silently binding an ephemeral port. Fixed: explicit empty-string check,
  defaults to 4433; throws on a genuinely non-numeric value instead of silently falling
  back.
- [x] CN-extraction used a naive regex (`/CN\s*=\s*([^,/\n]+)/`) that truncated at the
  first comma or slash, permanently blocking cert issuance for any `deviceCn` containing
  either character. Fixed: parse openssl's `-nameopt RFC2253` subject output with a
  proper DN parser that honors backslash-escaping.
- [x] `signCsr` shelled out to openssl three times per request. Reduced to two
  (structured pubkey extraction + RFC2253 subject extraction) — the third call was
  folded into the Node-side `crypto.createPublicKey` fix above; the remaining two each
  extract genuinely different structured data and can't be merged further without
  reintroducing fragile combined-text parsing.

### 19. API_SPEC.md's `POST /login` response missing `userId` — bug found during Phase 4 implementation
`CRYPTO_SPEC.md` §3 requires `userId` as part of the vault blob's AAD on every `GET /vault`
decrypt. But `POST /login`'s response (`{ sessionToken, expiresAt, wrappedVaultKeyPassword }`)
never included it — only `POST /register` returns `{ userId }`, a single one-time response.
A returning user logging in on any device that didn't just locally register (app reinstall,
second device, cache cleared) had no way to obtain their own `userId` to decrypt their vault.

- [x] Fix: `POST /login`'s response now also includes `userId` (`packages/server/src/routes/login.ts`
  — the handler already has `user.id` in scope at that point, trivial addition). Updated
  `loginResponseSchema` in `packages/core/src/api/types.ts` and `docs/API_SPEC.md`.

### 20. RecoveryScreen's flow couldn't complete — `/password-change` requires a session recovery doesn't have, found during Phase 4 implementation
`SCREENS_UX.md`'s RecoveryScreen flow (forgot master password) unwraps `vaultKey` via the
recovery key, then rewraps it under a new password and pushes the result. `API_SPEC.md`
said this "reuses the normal `/password-change` flow server-side" — but `/password-change`
has a `requireSession` preHandler, and recovery by definition has no active session (that's
the whole point of recovery: the user can't log in). As written, recovery could never
actually complete.

- [x] Fix: added `POST /recovery/password-change` — no session required. The client already
  proved possession of the recovery key by successfully unwrapping `wrappedVaultKeyRecovery`
  locally before calling it; the server can't verify that happened, same trust model `GET
  /recovery/wrapped-key` already accepts (recovery key never touches the server). Same
  atomic DB transaction as `/password-change`, except it invalidates *all* sessions (no
  "current" one to exempt) and returns a generic `401` for an unknown username rather than
  a session error, keeping the anti-enumeration guarantee. Rate-limited the same as `GET
  /recovery/wrapped-key`. Implemented in `packages/server/src/routes/recoveryPasswordChange.ts`,
  documented in `docs/API_SPEC.md`.

### 21. CI was broken on every commit since Phase 2, undetected — fixed after the user pasted failing CI logs
Three real bugs, all missed locally because local testing always worked against an
already-built `packages/core/dist/` left over from manual rebuilds during development;
CI's fresh checkout never had that:

- [x] **`test` job never built `@pwm/core` before running tests that import it** —
  `packages/server`/`packages/mobile` both resolve `@pwm/core` via its built `dist/`
  output (package.json `main`/`exports`), and the `test` CI job is a separate runner
  from `build` (no artifact sharing), so `@pwm/server`'s integration tests failed with
  "Failed to resolve entry for package @pwm/core" on every run since the first server
  commit. Fixed: added `pnpm --filter @pwm/core run build` to the `test` job in
  `.github/workflows/ci.yml`.
- [x] **Metro couldn't bundle `@babel/runtime` under pnpm's symlinked `node_modules`** —
  `packages/mobile`'s release build (`createBundleReleaseJsAndAssets`) failed with
  "Unable to resolve module @babel/runtime/helpers/interopRequireDefault", even though
  the file exists on disk at the expected path. Metro's default resolver doesn't follow
  pnpm's content-addressable `.pnpm/` store symlinks. Fixed in
  `packages/mobile/metro.config.js`: `resolver.unstable_enableSymlinks`,
  `unstable_enablePackageExports`, a root-pointing `watchFolders`, and an
  `extraNodeModules` proxy preferring the app's own `node_modules` — the standard
  pnpm+Metro monorepo fix.
- [x] **`packages/core`'s barrel export dragged the Node-only `argon2` native binding
  into any consumer, including mobile** — once the symlink issue above was fixed, Metro's
  bundler reached `@pwm/core`'s `index.ts`, which (via `export * from './kdf/argon2.js'`)
  imports the Node `argon2` package even though mobile only ever uses the plain
  `ARGON2ID_PARAMS` constant from that file, never the Node-binding functions. Metro
  bundles a module's full top-level imports regardless of which named export is actually
  used, so this broke mobile's bundle outright (`Unable to resolve module node:util`
  inside `argon2`'s own source). Fixed: split `kdf/argon2.ts` into `kdf/argon2Params.ts`
  (pure constants/types, exported from the main barrel — safe for mobile) and
  `kdf/argon2.ts` (the Node-only `deriveMasterKey`/`hashAuthKey` functions, no longer
  in the main barrel). Added a `./node` subpath export
  (`packages/core/package.json`'s `exports` map) for server code that needs the
  Node-only functions directly — `packages/server`'s own route code already calls
  `argon2` itself rather than through `@pwm/core`, so only test files needed updating.

Also bumped `actions/checkout`/`actions/setup-node` to v7 and `pnpm/action-setup` to v6
across both workflow files — the previous v4/v4 pins were triggering a Node 20
deprecation warning (not a failure, but worth clearing).

**Process gap, not just a code bug**: these went undetected for three pushes (Phase 2,
the Phase 1-3 code-review fix commit, and Phase 4) because CI status was never checked
after pushing — only local test runs were verified. Checking `gh run list`/`gh run view`
after every push is now something to do by default, not just when the user flags a
failure.

**Follow-up**: after the fixes above, CI's `build` job still failed on a fourth bug —
`node_modules/hermes-compiler` (the prebuilt Hermes bytecode compiler RN 0.87 ships as a
separate npm package) wasn't present in `packages/mobile/node_modules/` even though it
resolved fine inside the pnpm store. The gradle plugin's `detectOSAwareHermesCommand`
does a raw `File()` existence check for `node_modules/hermes-compiler/...` relative to
the mobile package's own root — not real Node module resolution — so it never found the
copy pnpm hoisted only as a transitive dependency of `react-native` itself. First
misdiagnosed this as sandbox-environment-specific (no network access to download
hermes-compiler) and said so in the commit that fixed the other three bugs; that
diagnosis was wrong — confirmed by reproducing the exact same failure in CI's own logs
after that push. Fixed by adding `hermes-compiler` (pinned to the exact version
`react-native@0.87.1` itself depends on) as an explicit `packages/mobile` devDependency,
so pnpm symlinks it into the package's own `node_modules` where the gradle plugin's
naive path check actually looks. Verified with a real `./gradlew assembleRelease`
success locally (55MB signed release APK), not just a bundle-step check.

### 22. Cert bootstrap deadlock + no public registration — found after Phase 4, resolved before Phase 5 (new)

Real architectural gap, found when Phase 4's mTLS client-cert work (left unimplemented,
per Phase 4's own notes above) was about to be picked back up: Caddy's `client_auth
require_and_verify` operates at the **TLS layer**, before Caddy can route by HTTP path.
A single mTLS-enforcing listener therefore has no way to carve out an exception for any
endpoint, including the ones a brand-new, cert-less device would need to reach to obtain
its first cert — `/register` and a first-cert-issuance endpoint are unreachable on a pure
mTLS listener by any device that doesn't already have a cert. Deadlock.

A second, related problem surfaced in the same discussion: the APK provides no
cryptographic proof of anything to the server — any value embedded in the APK can be
extracted by decompiling it, so "only accept requests from our app" cannot be enforced
by an app-side secret alone. Combined with an open, internet-reachable `/register`, an
attacker who merely finds the open port (no APK needed at all) could create accounts
server never intended to allow.

- [x] **Two separate Caddy listeners**, not one: a **LAN/VPN-only listener** (firewalled
  to the OpenVPN subnet, never port-forwarded) hosting exactly `POST /register` and
  `POST /cert/initial`; and the existing **port 443, full mTLS**, hosting everything else
  (`/login`, `/vault`, `/password-change`, `/cert/renew`, `/cert/revoke`, `/recovery/*`,
  and the new `/admin/*` group below). Requires real separate TCP listeners/bind
  addresses on Caddy — a path-based rule on one listener cannot work, since the TLS
  handshake (and its client-cert check) completes before Caddy knows which path was
  requested.
- [x] `POST /register` **auto-logs in on success**, returning the same shape `/login`
  returns (`{ sessionToken, expiresAt, userId, wrappedVaultKeyPassword }`). This removes
  the need for `/login` to ever exist on the LAN-only listener — it only ever serves
  already-certed devices, so it stays exclusively behind mTLS on port 443.
- [x] `registrationOpen` boolean flag (default `true`) gates `/register`, togglable via
  the new admin plane — user's intent is to flip it off once both real accounts exist.
- [x] `POST /cert/initial` (LAN-only, session-required, no existing-cert check) issues a
  device's first cert, reusing `/cert/renew`'s signing flow against pwm-ca.
- [x] **No hardcoded/default admin account** (explicitly rejected as an insecure-defaults
  anti-pattern — bad practice regardless of this being a 2-user private deployment, and
  directly against the project's own stated zero-knowledge/no-weak-links design
  principle). Instead: `users.is_admin BOOLEAN DEFAULT false`, and the **first registered
  user automatically becomes admin** (`userCount === 0` at the moment of insert). Every
  later registration defaults `is_admin = false`. Self-resolving from real registration
  order, no bootstrap credential, no manual DB edit, no default row shipped in the schema.
- [x] `/admin/*` route group (port 443, mTLS — LAN/VPN presence alone is **not**
  sufficient for these, an already-provisioned admin device's cert is also required):
  `PATCH /admin/registration` (toggle the flag), `GET /admin/users` (list accounts),
  `POST /admin/certs/:certId/revoke` (admin-triggered device revoke — covers "lost
  someone else's phone and they're not around to revoke it themselves"),
  `PATCH /admin/users/:id/admin` (promote another user — the only path for granting
  admin after the first user). Every route checks session + mTLS cert + `is_admin`;
  non-admin authenticated users get a generic `403`.
- [x] Explicitly **not building**: any endpoint for an admin to create an account on
  someone else's behalf. Self-registration (gated by the open/closed flag) stays the
  only account-creation path — the admin plane only ever gates/manages, never creates.

Tracked as **Phase 5** in `TASKS.md` (old Phase 5 "infra/deployment" renumbered to
**Phase 6** — infra deploy cannot start until this phase, the rest of Phase 4's open
items, and the 5 outstanding Phase 1-4 code-review findings are all resolved).

### 23. `POST /cert/renew`'s response was missing `certId` — found during Phase 5 mobile implementation
Same class of gap as #19 (missing `userId` in `/login`'s response): the device needs its
own cert's `certId` to later call `/cert/revoke` on itself (e.g. SettingsScreen's "forget
this device"), but `/cert/renew`'s response (`{ newCert }`) never returned it — only the
new `client_certs` row's `id`, generated server-side and then discarded.

- [x] Fix: `/cert/renew`'s response now also includes `certId`
  (`packages/server/src/routes/certRenew.ts` — the handler already creates the row and
  has its `id` in scope). Updated `certRenewResponseSchema` in
  `packages/core/src/api/types.ts` and `docs/API_SPEC.md`. The mobile-side
  `NativeMtlsClient.installCert()` now takes and persists `certId` alongside the cert
  (both at `/cert/initial` time and every `/cert/renew`), surfaced via
  `getActiveCertInfo()` for SettingsScreen to use.

### 24. Phase 5 code review (second pass) — 4 findings, all fixed
Peer review found 4 issues after the first Phase 5 commits landed:

1. **`SetupScreen.tsx` dead end on register-success/cert-initial-failure.** If
   `POST /cert/initial` failed (or the app crashed) right after `POST /register`
   succeeded, the account existed server-side with no cert and no way back in —
   retrying "Confirm and finish setup" called `register()` again with the same
   username, which 409s forever. Fix: the session returned by `register()` is now
   persisted (`services/config.ts`'s `setPendingSetupSession`/`getPendingSetupSession`/
   `clearPendingSetupSession`, via existing unencrypted `nativeStorage` — non-sensitive,
   just a session token) *before* calling `/cert/initial`, and cleared immediately after
   it succeeds. `SetupScreen` checks for a pending session on mount and, if found, skips
   straight to a new `resumeCertOnly` step that retries only `/cert/initial` — never
   `register()` again. A resume can't restore the in-memory `vaultKey` (zero-knowledge:
   it never touched disk or the server), so a resumed setup routes to `LoginScreen`
   afterward instead of straight to the vault, same as any other device unlocking with
   its password.
2. **Cert renewal only ran once, at cold start.** `checkAndRenewCertIfNeeded` was wired
   into the mount-only cold-start effect behind the biometric-cache resume path only —
   never on `AppState` foreground, never after a manual `/login`. A long-lived app
   (background/foreground repeatedly, never fully killed) or any non-biometric login
   never got a renewal check again, risking an expired cert locking the device out of
   the mTLS listener entirely. Fix: extracted a shared `runCertRenewalCheck` (toast
   wrapper around `checkAndRenewCertIfNeeded`) into `services/certRenewal.ts`, now called
   from three places — cold-start resume, `App.tsx`'s `AppState` foreground handler (when
   not idle-locking), and `LoginScreen.tsx`'s manual-login success path.
3. **Cert-issuance log events used `fingerprint` instead of the `certId` row id** in
   `certInitial.ts`, `certRenew.ts`, and `admin.ts`'s revoke route — `certId` is typed and
   named as the DB row id everywhere else, so this broke log-to-DB correlation
   (`MONITORING.md`). Fix: all three now pass the actual `ClientCert` row `id`.
4. **`vaultSync.ts`'s `pushVaultIfDirty()` had no in-flight guard.** Overlapping calls
   (e.g. rapid double-tap on `EntryDetailScreen`'s delete, which — unlike
   `EntryEditScreen`'s save — had no `saving` state disabling the button) each
   snapshotted `dirty` independently and could race on `markSynced`, silently dropping a
   second caller's change. Fix: `pushVaultIfDirty` now chains every call onto a
   module-level `inFlight` promise so overlapping calls serialize instead of racing,
   rather than adding a per-screen guard that would only cover one call site.

Verified: full test suite (48 core + 39 server + 41 mobile + 32 ca-service = 160 tests),
lint/format clean, both `./gradlew assembleDebug` and `assembleRelease` succeed.