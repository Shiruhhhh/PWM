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

### 25. services/ca never actually implemented TLS/mTLS — found live during Phase 6 deploy
`docs/CA_SERVICE_SPEC.md` says the `/sign`/`/revoke`/`/crl` endpoints are "internal
mTLS", and `packages/server/src/lib/caClient.ts`'s `httpCaClient` was already built
presenting a client cert via an undici `Agent`'s `connect.{cert,key,ca}` — but
`services/ca/src/index.ts` only ever called `app.listen({port, host})` with no `https`
option at all. Confirmed live on CT 202 (pwm-ca) during Phase 6: the service answered on
plain `http://`, not `https://`. `caClient.ts`'s mTLS handshake would have had nothing to
negotiate against — every `/sign`/`/revoke` call from pwm-app would fail once deployed.
This was never caught by `app.test.ts`, since Fastify's `.inject()` (used by every
existing test) bypasses the real network listener and TLS entirely.

- [x] `services/ca/src/app.ts`'s `buildApp()` now takes an optional `BuildAppOptions.https`
  (`{cert, key, ca, requestCert, rejectUnauthorized}`), passed straight through to
  Fastify's own `https` constructor option. Omitted (tests, previous behavior) falls back
  to plain HTTP. Needed an explicit `Fastify<https.Server>(...)` generic — Fastify's TS
  overloads otherwise infer the server type per-branch and produce an unreconcilable
  route-handler union if the `https`-vs-not choice happens inside the function.
- [x] `services/ca/src/index.ts` now reads `server.crt`/`server.key`/`ca.crt` and passes
  them as `https: {cert, key, ca, requestCert: true, rejectUnauthorized: true}` — real
  mTLS enforcement at pwm-ca's own listener, not just relying on the Proxmox firewall
  rule (defense in depth, matches `CA_SERVICE_SPEC.md`'s explicit wording).
- [x] `services/ca/scripts/bootstrap.sh` gained a new step 2/3: generates pwm-ca's own
  server keypair and self-signs it with the CA key (same CA that signs every client
  cert), with a `subjectAltName=IP:<server-ip>` extension — required because
  Node/undici's TLS verification checks SAN against the connection hostname/IP, not just
  CN, and `httpCaClient` connects directly to pwm-ca's IP. `-copy_extensions copy` on the
  `openssl x509 -req` signing step was needed too — it drops CSR extensions (including
  SAN) by default otherwise. Verified locally: SAN present in the final cert, chain
  verifies against `ca.crt`.
- [x] New `services/ca/src/tls.test.ts` — real end-to-end mTLS test over an actual
  network listener (`app.listen()` + a real fetch, not `.inject()`): accepts a request
  presenting a CA-signed client cert, rejects one with no client cert, rejects one with a
  client cert signed by a *different* CA. This is the test category that would have
  caught this gap originally — added specifically because `.inject()`-only coverage
  missed it.
- [x] `config.ts` gained `serverCertPath()`/`serverKeyPath()`.
- Deploying this fix to the already-running CT 202 requires re-running (an updated)
  bootstrap or manually generating the server cert against the existing CA key, then
  restarting the service — tracked as a Phase 6 resume step, not done automatically by
  this commit (the CA key must never be regenerated; only the new server cert needs
  adding on top of it).

### 26. `packages/server/Dockerfile`'s runtime stage never actually generated a working Prisma client — two wrong fixes before the real one, found live during Phase 6's first `docker compose build`/`up`
First attempt (commit `63b2d0d`): added `prisma migrate deploy` to the container's `CMD`
without checking the runtime stage's existing `prisma generate` call — missed that
`pnpm install --prod` (same stage, line above it) strips `prisma` from
devDependencies, so that `RUN pnpm exec prisma generate` call was already broken before
this phase, just never exercised (no deploy had been attempted yet).

Second attempt, still wrong (commit `1254b41`): moved `prisma` from devDependencies to
dependencies (correct — it's needed at runtime for `migrate deploy` too) but then
**deleted** the runtime-stage `prisma generate` call entirely, reasoning that
`@prisma/client`'s own postinstall hook (observed running during the `--prod` install's
output) already regenerated the client. Building looked clean. **Only caught by actually
running the container**, not just building the image: `docker compose up -d` produced a
live crash loop —
`Error: @prisma/client did not initialize yet. Please run "prisma generate"`. The
postinstall hook's own output had already said why, buried in its warnings:
`"We could not find your Prisma schema in the default locations"` — it runs from `/app`
(the pnpm workspace root), not `packages/server/`, so its default-location search never
finds `packages/server/prisma/schema.prisma` at all. A clean `docker compose build` is
not evidence the image actually works — this gap would have shipped past a build-only
check.

- [x] Real fix: kept `prisma` as a real dependency (from attempt 2 — correct), and put
  back the runtime-stage `RUN pnpm --filter @pwm/server exec prisma generate
  --schema=prisma/schema.prisma` call (undoing attempt 2's deletion), now that `prisma`
  is actually present in that stage's `node_modules` to run it with. Confirmed by
  rebuilding, redeploying to the real CT 201, and watching `docker compose logs
  node-app` show a clean start with no crash loop and `No pending migrations to apply`.
- Process note: verify a container deploy by starting it and reading logs, not just by
  a successful `docker compose build` — same category of mistake as `DECISIONS.md` #21's
  "claimed success from an incomplete local diagnosis" entry, now specifically for
  multi-stage Docker builds where a later stage's install can silently drop something an
  earlier stage's postinstall hook depended on.

### 27. `crlPoller.ts` used a bare, unauthenticated `fetch` — same mTLS gap as #25, different code path
Found immediately after fixing #25/#26 and actually starting the real container: node-app
logged `crl_poll_failed`, `"self-signed certificate in certificate chain"` on every poll.
Root cause: `startCrlPoller` took a raw `caServiceUrl` string and an optional bare
`fetchImpl`, calling `GET /crl` with no client cert and no CA trust at all — a completely
separate code path from `caClient.ts`'s `httpCaClient` (which does present a client cert
via an undici `Agent`). `CA_SERVICE_SPEC.md`'s "internal mTLS" requirement covers every
endpoint, `/crl` included — it was never exempted for being a read.

- [x] Added `getCrl()` to the `CaClient` interface, implemented in `httpCaClient` via a
  new `get()` helper (the existing `request()` helper was hardcoded to POST). Both
  `notYetImplementedCaClient` and the test suite's `fakeCaClient` implement it too.
- [x] `crlPoller.ts`'s `CrlPollerOptions` now takes a `caClient: CaClient` instead of
  `caServiceUrl`/`fetchImpl` — the poller calls `caClient.getCrl()`, reusing the exact
  same mTLS-presenting connection `sign()`/`revoke()` already use, instead of building a
  second, unauthenticated one.
- [x] `app.ts`'s gating changed from `if (caServiceUrl)` to `if (caClient)` — starts the
  poller whenever a usable client actually exists (matching every other CA-dependent
  route's own condition), not just whenever the URL env var happens to be set.
- [x] New `crlPoller.test.ts` — the poller had **no test coverage at all** before this;
  nothing asserted it went through an authenticated client rather than a bare fetch, which
  is exactly how this shipped unnoticed through #21-#26's otherwise-thorough test passes.
  Added 3 tests: calls `caClient.getCrl()` and populates the cache, logs a structured
  error and keeps the stale cache on failure, `stop()` actually stops further polling.
- Verified against the real running stack on CT 201/202: `docker compose logs node-app`
  showed `crl_poll_failed` before this fix, clean (no error) after rebuilding and
  restarting with it.

### 28. Mobile app can't trust the bootstrap listener's TLS cert via the system trust store — pinning against the internal CA root instead
Found during the first real-device setup attempt: `/register` instantly failed with
"network request failed" against the LAN-only `:8443` listener, even with the correct
IP/port and real VPN/LAN connectivity confirmed. Root cause: `infra/Caddyfile`'s `:8443`
block is a bare port with no hostname, so Caddy can never request a Let's Encrypt cert
for it — with no explicit `tls` directive it falls back to its own ad-hoc self-signed
cert, which Android's (or any mobile OS's) default trust store doesn't trust. RN's plain
`fetch()` (what `apiClient.ts`'s `bootstrapRequest` used) has no way around that.

A cert signed by our own internal CA would hit the identical problem — nothing on the
device trusts that CA either, without manual per-device cert installation, which defeats
the whole "no manual provisioning" point of a self-hosted app. Same for Caddy's `tls
internal` option — still just an unknown CA as far as the OS is concerned.

- [x] Give `:8443` an actual server cert, signed by the internal CA (reusing
  `services/ca`'s existing bootstrap infrastructure) — `infra/Caddyfile`'s `:8443` block
  now has an explicit `tls /etc/pwm/bootstrap-server.crt /etc/pwm/bootstrap-server.key`.
  `docker-compose.yml` bind-mounts both from `/etc/pwm-app-cert/` (same host dir pwm-app's
  own client cert already lives in).
- [x] `services/ca/scripts/bootstrap.sh` documents the one-time CSR-transfer step to
  generate this cert, same pattern as the existing pwm-app-client step (CN=pwm-app-bootstrap,
  SAN=IP:192.168.1.10).
- [x] The mobile app bundles the CA root cert itself as an Android asset
  (`android/app/src/main/assets/pwm-ca-root.pem`) and pins against it — a new
  `NativeMtlsClient.bootstrapRequest()` TurboModule method builds an OkHttp client with a
  custom `X509TrustManager` that trusts ONLY this one root, bypassing the system trust
  store entirely for this one connection. The real mTLS client used after setup
  (`request()`) is untouched — it still trusts the system store for the public listener's
  Let's Encrypt cert, per #22.
- [x] `apiClient.ts`'s `bootstrapRequest` now goes through this pinned native path
  (`bootstrapPinnedRequest` in `mtlsClient.ts`) instead of plain `fetch` — no client cert
  presented either way (a brand-new device doesn't have one yet), just a different trust
  path for the server side.
- Still pending: the actual leaf cert (`bootstrap-server.crt`/`.key`) hasn't been generated
  against the real CA yet, nor deployed to pwm-app's `/etc/pwm-app-cert/` or Caddy
  restarted with it — that's a live-infra step requiring direct user confirmation, same
  as every other change touching the deployed stack in Phase 6.
- Gap: no automated test covers `apiClient.ts`'s `bootstrapRequest` (pre-existing —
  `apiClient.ts` has no test file at all; the native module it calls can't easily be
  exercised under Jest either). Verification is manual, on a real device, same as #25-#27.

### 29. CA root/certs moved from Ed25519 to ECDSA P-256 — a real Android device's TLS stack never offers Ed25519 in its ClientHello
Found while testing #28's pinning fix on a real device: `/register` consistently failed
with `SSLV3_ALERT_HANDSHAKE_FAILURE` / `HANDSHAKE_FAILURE_ON_CLIENT_HELLO`, deterministically,
on every retry, regardless of IP/port correctness, VPN vs. direct LAN, TLS version pinning
(`TLSv1.3` vs. platform-default `TLS`), or Caddy's key-exchange group list (tested
restricting to classical X25519 in case a post-quantum hybrid group was the culprit — it
wasn't). `openssl s_client` from multiple vantage points (the Proxmox host, inside CT 201,
and over the same VPN path the phone used) always succeeded against the identical server
config, which narrowed this to something phone-specific.

Root cause, confirmed via packet capture (`tcpdump` on CT 201, comparing the phone's real
`ClientHello` against a working `openssl` one byte-for-byte): the phone's `signature_algorithms`
extension (0x000d) listed `0403 0804 0401 0503 0805 0501 0806 0601 0201` — ECDSA
(P-256/P-384/P-521), RSA-PSS, and RSA-PKCS1 variants (down to legacy `sha1`) — but **no
`0807` (ed25519)** at all. Caddy's bootstrap-server leaf cert is Ed25519-only; given zero
overlap between what the client claims to support and what the cert can sign with, Caddy
sends a `FIN` right after reading the ClientHello — no `ServerHello`, no cert exchange, no
chance for the app's trust-manager/pinning code (confirmed via diagnostic logging) to even
be invoked. `openssl s_client`'s default sigalgs list always includes `ed25519`, which is
why every server-side test looked completely healthy despite the real bug.

- [x] `services/ca/scripts/bootstrap.sh`: every `openssl req -newkey ed25519` →
  `-newkey ec -pkeyopt ec_paramgen_curve:P-256` (CA root, pwm-ca's own server cert,
  pwm-app's client cert, the bootstrap-server leaf cert from #28 — all four).
- [x] `services/ca/src/openssl.ts` needed no changes — `validateCsrKeyStrength` already
  accepted `prime256v1` (P-256) as an approved EC curve, and the signing invocation's
  `-sha256` digest flag is exactly right for ECDSA-SHA256 (it was a no-op for Ed25519's
  own fixed internal hash before, now it's load-bearing).
- Pending: the actual re-bootstrap (new CA key, reissue all four certs, redeploy to
  pwm-ca/pwm-app, restart affected services) is a full re-run of Phase 6's CA bootstrap
  chain — live-infra work requiring direct user confirmation before execution, same as
  every other change touching the deployed stack. Only one test account exists under the
  current (Ed25519) CA; user confirmed a clean re-bootstrap with no migration/preservation
  needed.
- Process note: this is the second time in this session a "server tests fine from every
  angle, client fails every time" symptom turned out to be a real client-side TLS stack
  capability gap, not a config bug — `openssl s_client`'s defaults (broad sigalg/cipher
  support, explicit sigalgs flags available) make it a poor proxy for what a real mobile
  OS's TLS stack actually offers. A packet capture comparing the two ClientHellos directly
  settled it where guessing and incremental server-side tweaks (TLS version pinning, key
  exchange group restriction) did not.
- [x] Full re-bootstrap executed and verified live: new P-256 root/certs deployed to
  pwm-ca and pwm-app, setup flow confirmed working on the real device afterward. Hit one
  real bug along the way: `bootstrap.sh` runs interactively as root, but `pwm-ca.service`
  runs as the restricted `pwm-ca:pwm-ca` systemd user (`ProtectSystem=strict`) — the
  regenerated key/cert files were left `root:root`-owned, crashing the service with
  `EACCES` on restart. Fixed by adding a `chown pwm-ca:pwm-ca` step to `bootstrap.sh`
  itself (conditional on that user already existing, since a first-time bootstrap runs
  before the systemd unit is installed).

### 30. Real-device client-cert TLS signing: `INCOMPATIBLE_DIGEST` from Android Keystore
Found testing #28/#29's fix on the real device: with the CA correctly on ECDSA P-256,
`/register` and `/cert/initial` (the LAN-only listener, pinned against the CA root, no
client cert) worked. But the very first attempt to actually USE the newly-issued device
client cert — any request through the public mTLS listener, `request()` in
`MtlsClientModule.kt` — failed deterministically with:
```
java.security.InvalidKeyException: Keystore operation failed
Caused by: android.security.KeyStoreException: Incompatible digest (Error::Km(INCOMPATIBLE_DIGEST))
```
Multiple theories tested and ruled out, each confirmed wrong by direct on-device retest
(not guessed around): widening `setDigests()` to SHA-256/384/512 (no change); StrongBox
involvement (confirmed via `KeyInfo.securityLevel`/`isInsideSecureHardware` logging — the
key was always TEE-backed, `setIsStrongBoxBacked(false)` was a no-op fix); `ks.setKeyEntry()`
corrupting the key's authorizations when swapping in the real CA-signed cert over the
Keystore's auto-generated self-signed placeholder (storing the real cert in
SharedPreferences instead, never touching the Keystore-visible cert/key entry post-generation
— no change); missing `X509ExtendedKeyManager` SSLEngine-aware overloads
(`chooseEngineClientAlias`/`chooseEngineServerAlias`, since OkHttp/Conscrypt's TLS 1.3 path
uses `SSLEngine`, not the legacy `Socket` API — added, no change); a transient Keystore
daemon glitch (survived a full device reboot, no change).

Real root cause: TLS's `CertificateVerify` signs a **pre-computed transcript hash**, not
raw plaintext — Conscrypt's internal signing call uses `NONEwithECDSA` (sign over an
already-hashed digest, no re-hashing), not `SHA256withECDSA` (which `KeystoreContentSigner`
uses for CSR signing, and which worked fine). The key's `KeyGenParameterSpec` only
authorized `DIGEST_SHA256`/`SHA384`/`SHA512` — `DIGEST_NONE` was never in the list, so
Keystore2/KeyMint rejected the raw-digest signing operation outright every time, for every
digest Conscrypt internally tried, matching the exact symptom (instant, deterministic,
every attempt, regardless of which specific digest got probed).

- [x] `generateKeyAndCsr()`'s `KeyGenParameterSpec` now calls
  `.setDigests(DIGEST_NONE, DIGEST_SHA256, DIGEST_SHA384, DIGEST_SHA512)` — `NONE` added
  alongside the existing SHA-2 family (not replacing it; `KeystoreContentSigner`'s own
  `SHA256withECDSA` CSR signing still needs `SHA256` authorized).
- [x] Added `chooseEngineClientAlias`/`chooseEngineServerAlias` overrides to
  `SingleAliasKeyManager` regardless (correct per `X509ExtendedKeyManager`'s contract even
  though it wasn't the fix here — Conscrypt's actual code path for a `SSLEngine`-based
  connection should use these, not the legacy `Socket`-taking overloads).
- [x] Kept the `setKeyEntry()`-avoidance fix (storing the real cert in SharedPreferences,
  `installCert()` never touches the Keystore-visible cert chain after generation) even
  though it was confirmed NOT the actual cause of this bug — ruling it out required
  shipping it, and no reason to revert a working, already-tested change back to the
  original `ks.setKeyEntry()` call. The Keystore-visible cert stays the original
  self-signed placeholder forever; `buildSslContext()`/`getActiveCertInfo()` read the real
  cert from the `ACTIVE_CERT_PEM_PREF_KEY` pref instead — this is the actual deployed
  behavior, not `ks.setKeyEntry()`.
- Verified live: user registered a fresh account, the device's client cert successfully
  signed a real `PUT /vault` request (saving a password entry) with zero errors — the
  first confirmed-working real mTLS request on an actual device, through the full
  Keystore-signing path, in this project's history.
- Added (then removed once confirmed fixed) a temporary diagnostic `console.error` in
  `LoginScreen.tsx`'s catch block — the UI's error message is deliberately generic
  (anti-enumeration), which made isolating a *different* bug (#31) much slower than it
  needed to be. Worth remembering for future on-device debugging: a one-line temporary
  `console.error(err)` before the generic `setError(...)` costs nothing and pays for
  itself immediately.

### 31. Login's second API client was never given the session token — `getVault()` always 401'd after a successful login
Found immediately after #30 was confirmed fixed: login now completed the actual `POST
/login` successfully (confirmed via `node-app` logs — `login_attempt, success: true` on
every single attempt, including ones the user saw fail client-side), but the client showed
the generic "login failed" error anyway, every time, for every account including a
brand-new one that had just succeeded at register + a real vault save moments earlier.

Root cause: `LoginScreen.tsx`'s `handleLogin()` builds one `ApiClient` instance via
`createApiClient({ baseUrl })` *before* the session token exists (it's needed just to call
`getLoginParams`/`login`, both of which are correctly session-free). After `login()`
returns a `sessionToken`, the code kept using that SAME client instance for
`api.getVault()` — a session-required endpoint (`requireSession` preHandler) — so the
request carried no `Authorization` header at all, hitting `requireSession`'s
missing-token branch and returning a 401. `SetupScreen.tsx` already had the correct
pattern for this exact situation (`bootstrapApiWithSession`, a second client built once
the session token is known) — `LoginScreen.tsx` just never followed it.

- [x] `LoginScreen.tsx`: `getVault()` now goes through a new `apiWithSession` client,
  built with `loginResult.sessionToken`, instead of reusing the token-less `api`.
- [x] Found and fixed the same bug in `VaultListScreen.tsx`'s pull-to-refresh
  (`onRefresh`) — same pattern, `createApiClient({ baseUrl })` with no `sessionToken`,
  calling `getVault()`. Added `sessionToken` from `useAuthStore`, passed through to the
  client, added to the `useCallback` dependency array.
- [x] Checked every other `createApiClient(...)` call site
  (`vaultSync.ts`, `certRenewal.ts`, `SettingsScreen.tsx`, `RecoveryScreen.tsx`) — all
  already correctly pass `sessionToken` where one is needed; `RecoveryScreen.tsx`'s two
  calls are deliberately session-free (recovery routes have no `requireSession`
  preHandler server-side, by design — you've forgotten your password, there's no session
  to have yet).
- Process note: this bug existed in the code since Phase 5 (per the summary this session
  continued from), survived that phase's review passes and the full test suite, and was
  only ever actually reachable by exercising a real login against a real server on a real
  device — `LoginScreen.tsx` has no test file (confirmed, same gap noted for
  `apiClient.ts`/`SetupScreen.tsx` flows elsewhere in this doc), and nothing in the
  existing test suite happens to construct two sequential API clients the way a real
  login does. A real end-to-end device test caught something a long chain of unit/integration
  tests and code review passes did not.

### 32. Hermes also has no global `TextEncoder`/`TextDecoder` — same class of gap as the `crypto` polyfill
Found right after #31 was fixed: login now worked for empty-vault accounts, but any
account with at least one saved password entry failed with
`ReferenceError: Property 'TextDecoder' doesn't exist` (an uncaught promise rejection,
not routed through `LoginScreen.tsx`'s own catch block at all — Hermes threw before any
of our error handling could run). Explains the earlier-observed pattern exactly:
`Teste1`/empty-vault logins worked, `Teste2`/`Teste3` (both had a saved password) failed
every time, consistently.

Root cause: `@pwm/core`'s crypto code (`aad.ts`, `keyWrap.ts`) and the `@noble/*` crypto
libraries it depends on use `TextEncoder` (confirmed directly in our own source) and
transitively `TextDecoder` (not found in our own source directly, but clearly reachable
through some encode/decode path only exercised once there's real vault content to
process). Hermes doesn't implement either global, same gap class as the earlier
`crypto.getRandomValues` fix from this session's crypto-polyfill work — except this one
only manifests once there's actual non-empty data to encode/decode, so a brand-new,
empty-vault account's register → login cycle never touches it at all, which is exactly
why it stayed invisible through every earlier test this session (including #30's "first
confirmed working real mTLS request" — that was still an empty vault).

- [x] Added `text-encoding` as a dependency, imported and assigned to
  `global.TextEncoder`/`global.TextDecoder` in `index.js`, right after the existing
  `react-native-get-random-values` import. Unlike that package, `text-encoding` doesn't
  self-install as a global on import — needs an explicit assignment, guarded with
  `typeof ... === 'undefined'` so it's a no-op if a future RN/Hermes version ever adds
  native support.
- Process note: this is the SECOND Hermes-missing-standard-global bug found this session
  (the first being `crypto.getRandomValues`), both only surfaced by a real device
  exercising a code path that Jest's Node-based test environment never would (Node has
  both globals natively, so nothing in the existing test suite could ever have caught
  either gap). Worth deliberately auditing `@pwm/core` and its dependencies for any other
  Web-standard global they assume exists, rather than waiting for each one to surface
  one at a time on a real device.

### 33. `docker-compose.yml` had no bind mount for `APP_RELEASES_DIR` — same class of gap as the earlier `/var/log/caddy` miss
Found before the first real `scripts/deploy-apk.sh` run (Phase 7): `GET /app/version`/
`GET /app/apk` read from `APP_RELEASES_DIR` (default `/etc/pwm-app-releases`), and
`deploy-apk.sh` writes the APK/`version.json` to that same path on the pwm-app host — but
`docker-compose.yml`'s `node-app` service had no bind mount for it at all, so the
container's filesystem would never actually see what the deploy script wrote. Identical
root cause to #29's writeup elsewhere in this doc (the `/var/log/caddy` miss): a route
was written against an env-var path without a corresponding volume entry ever being
added to make that path actually exist inside the container.

- [x] Added `/etc/pwm-app-releases:/etc/pwm-app-releases:ro` to `node-app`'s `volumes` in
  `docker-compose.yml`, plus an explicit `APP_RELEASES_DIR=/etc/pwm-app-releases` in its
  `environment` block (previously relying on the code's own default — made it explicit
  here instead, matching how every other deploy-relevant path in this file is already
  spelled out rather than left implicit).
- Process note: this is the second time this exact class of bug (a server route reading
  a host path with no corresponding Docker bind mount) has been caught before causing a
  real outage, both times during live pre-deploy verification rather than by code review
  or the test suite (which runs server code directly, outside Docker, so it can't catch a
  missing container mount by construction). Worth remembering when adding any future
  route that reads from the filesystem: check `docker-compose.yml` has the matching mount
  BEFORE considering the feature done, not after something fails against real infra.

### 34. Phase 7's real-device test found 2 more bugs — stale deployed image, banner under the status bar
Running the actual first end-to-end update test (install old build → in-place update to
a build with the update code → deploy a newer version → confirm detection → tap update →
confirm install + data survival) surfaced two real bugs, neither caught by the build/test
suite/code review pass that preceded it:

1. **Stale `node-app` image.** After #33's `docker-compose.yml` bind-mount fix was
   applied and the container recreated, `GET /app/version` still 404'd — not the 503
   error path built for a missing `version.json`, a plain 404, meaning Fastify didn't
   even have the route registered. Root cause: "recreate the container" only picks up a
   `docker-compose.yml` change; the `node-app` *image* itself was still built from a
   commit before `appVersion.ts`/`appApk.ts` existed. Confirmed by checking the deployed
   source tree directly on CT 201 — those files genuinely weren't there. Needed an actual
   `docker compose build node-app` (not just `up -d`/recreate) to pick up the real route
   code. Diagnosed via a temporary diagnostic toast added to `appUpdate.ts` (release
   builds have no Metro console; a silently-caught error is otherwise invisible) — removed
   again once the real cause was confirmed and fixed.
2. **`UpdateBanner` rendered under the status bar/notch.** It's top-level chrome in
   `App.tsx`, rendered as a sibling above `<Router>`, outside any screen's own layout —
   nothing else in the app accounts for the safe area for it specifically. On a real
   device with a camera cutout, the banner's buttons rendered underneath the system
   status bar icons and were physically untappable. Fixed with `useSafeAreaInsets()` from
   `react-native-safe-area-context` (already a dependency, just never previously used
   anywhere in the app) added directly to `UpdateBanner.tsx`.

Both bugs, plus #33, found and fixed only because the feature was actually exercised
end-to-end on a real device rather than stopping at "the code compiles and the unit tests
pass" — consistent with every other real bug found this session (#25-33). Full cycle
verified working afterward: old build → in-place update preserving all local data →
server-reports-newer detection → banner (correctly positioned) → tap-to-update →
download → install → data still present.

### 35. No way for an existing account's device to get a fresh client cert without `/register` — new `/cert/initial-for-existing-user` route
Found via a real self-inflicted scenario during Phase 7's device testing: Android
correctly refuses to install a lower `versionCode` over a higher one already installed
(`INSTALL_FAILED_VERSION_DOWNGRADE`), so testing an older build required an actual
uninstall. That wiped the device's Keystore-backed client cert — on relaunch, with no
cert installed, `App.tsx`'s cold-start check routes straight to `SetupScreen`, which only
ever supported registering a brand-new account. Re-registering under the same username
would `409` (`/register`'s own "username taken" check); there was no path at all for "I
have an account already, this device just needs pairing."

Root cause: the LAN-only `:8443` listener only ever hosted `/register` and `/cert/initial`
(per #22) — both assume a brand-new account. `/login` is deliberately scoped to the
mTLS-only `:443` listener ("only ever serves devices that already have a client cert," per
API_SPEC.md), so a cert-less device genuinely has no way to prove it owns an existing
account.

Two designs discussed with the user; chosen: a **new, narrowly-scoped LAN-only route**
(`POST /cert/initial-for-existing-user`) rather than exposing `/login` itself on the
bootstrap listener — keeps `/login`'s own threat model/placement untouched, and keeps the
bootstrap listener's routes purpose-specific (new account / re-cert existing account),
not a general-purpose auth surface.

- [x] `packages/server/src/routes/certInitialForExistingUser.ts` — verifies the password
  exactly like `/login` (same Argon2id recompute + constant-time compare, same generic
  401 on any failure, no enumeration), then issues a cert exactly like `/cert/initial`, in
  one call. Same rate limit class as `/login`. New
  `certInitialForExistingUserRequestSchema`/`...ResponseSchema` in `@pwm/core`.
- [x] `GET /login/params` added to BOTH listeners' bootstrap-only path allowlist in
  `infra/Caddyfile` (it already existed in the Fastify app globally, just was never
  reachable on `:8443` — Caddy's path matcher gates it) — the client needs
  `clientSalt`/`kdfParams` to derive the right `authHash` before calling the new route,
  same two-step shape `/login`'s own flow already uses.
- [x] `SetupScreen.tsx` gains an "I already have an account" mode toggle on the account
  step — same username/password fields, no recovery-key display/confirm step (the account
  already has one from when it was first created), calls the new endpoint instead of
  `/register`, then fetches and decrypts the REAL existing vault (not an empty one --
  `finishCertInitialAndLogin`'s new-account path seeds `setEntries([], 0)`, which would
  have silently wiped the user's view of their own data if reused here).
- 4 new server-side tests: successful re-pair + usable session, wrong password (generic
  401), unknown username (generic 401, no enumeration), confirms no session is required
  (unlike `/cert/initial`).
- Exercised on the real device this was found on — the re-pair flow itself worked,
  recovered the account successfully. But that same change introduced a real regression,
  caught immediately after: `infra/Caddyfile`'s public-listener matcher
  (`@bootstrapOnlyRoutes`) got `/login/params` added to its **deny** list by mistake,
  alongside the two routes that genuinely belong there. `/login/params` is a normal
  public-listener route — `LoginScreen.tsx`'s own flow calls it over mTLS every time — so
  this broke ordinary login for every device with a cert, immediately after fixing the
  no-cert case. Root cause: conflating "needs adding to the LAN-only listener's allowlist"
  (correct, `/login/params` wasn't reachable there before) with "needs adding to the
  public listener's deny-list too" (wrong — only `/cert/initial-for-existing-user`
  belongs on that deny-list; a device that can reach the public listener at all already
  has a valid cert and never needs the no-cert recovery route).
- [x] Fixed: `/login/params` removed from the public listener's `@bootstrapOnlyRoutes`
  matcher — it's not a bootstrap-only route there, never was. Only
  `/cert/initial-for-existing-user` is denied on `:443`. Confirmed via a real login after
  the fix deployed.
- Process note: editing the same named matcher in two site blocks for two different
  purposes (add here, add there for a different reason) is an easy way to accidentally
  conflate them — worth a comment on each block's matcher spelling out exactly what
  belongs there and why, which is what both blocks now have.