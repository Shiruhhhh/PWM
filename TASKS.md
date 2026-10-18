# PWM — Development Tasks

This file is the entry point for implementation. Read it fully, then read every doc it references before writing code — specs are the source of truth, do not re-derive or invent design decisions that already have an answer here.

## Before anything else

1. Read, in this order (all under `docs/`): `DECISIONS.md`, `CRYPTO_SPEC.md`, `DB_SCHEMA.md`, `API_SPEC.md`, `SCREENS_UX.md`, `DEPENDENCIES.md`, `CA_SERVICE_SPEC.md`, `PROXMOX_NETWORK.md`, `BACKUP.md`, `MONITORING.md`, `TESTING.md`, `DEPLOY.md`, `THREAT_MODEL.md`.
2. All design decisions are already made — do not ask the user to re-decide anything already resolved in `DECISIONS.md`. If something genuinely isn't covered by the docs, stop and ask rather than guessing, especially for anything crypto-related.
3. This is a learning + open-source project — code quality, test coverage, and documentation matter as much as working features. No shortcuts on the crypto core.
4. Monorepo, `pnpm` workspaces: `packages/core`, `packages/server`, `packages/mobile`, plus `services/ca` for the CA signing service (not a workspace package, separate deployable, per `CA_SERVICE_SPEC.md`).

## Phase 0 — repo scaffold

- [x] Initialize git repo, `pnpm-workspace.yaml`, root `package.json`, `.gitignore` (node_modules, .env, build artifacts, *.key, *.p12, *.pem — never allow cert/key material to be committed).
- [x] `LICENSE` (MIT).
- [x] `.env.example` at root and per-package as needed (per `DEPLOY.md`).
- [x] ESLint + Prettier config, shared across packages.
- [x] `.github/workflows/ci.yml` per `TESTING.md` / `DEPLOY.md` (lint, build check — tests added as each package gets them).
- [x] Verify `README.md`, `docs/THREAT_MODEL.md`, and all design docs already in `docs/` are committed as-is (don't rewrite them, they're the spec).

## Phase 1 — packages/core (crypto, do this first, get it right before anything depends on it)

Follow `CRYPTO_SPEC.md` exactly — exact algorithms, exact parameters, exact domain-separation strings.

- [x] Argon2id wrapper (native bindings, params from spec: 64 MiB, 3 iterations, parallelism 4, 32-byte output).
- [x] HKDF-SHA256 split into `vaultKey` / `authKey` using the exact `info` strings in the spec. (Also added a third `vaultWrapKey` subkey — see `docs/DECISIONS.md` #16, fixes a circular-key bug found in §5 as literally written.)
- [x] AES-256-GCM encrypt/decrypt for vault blob, with the exact wire format (`version || nonce || ciphertext || authTag`) and AAD (`userId || blobFormatVersion`).
- [x] Vault key wrapping/unwrapping for both password-derived key and recovery key paths.
- [x] Vault blob JSON schema + `zod` validation, versioned per spec.
- [x] Recovery key generation (24-word mnemonic, cryptographically random 32 bytes).
- [x] Shared TypeScript types for API request/response payloads (used by both server and mobile).
- [x] **Tests first-class citizen here**: known-answer tests, round-trip tests, negative/tamper tests, domain-separation test — per `TESTING.md`. 48/48 passing across 8 test files.

## Phase 2 — packages/server (Node/Fastify backend)

Follow `API_SPEC.md` and `DB_SCHEMA.md` exactly.

- [x] Prisma schema from `DB_SCHEMA.md`, initial migration. (`last_used_at` column added to match API_SPEC.md's rolling-TTL session model — see `docs/DB_SCHEMA.md` and `docs/DECISIONS.md`.)
- [x] Fastify app skeleton, `zod`-based schema validation via `fastify-type-provider-zod`.
- [x] Implement endpoints in this order: `GET /login/params`, `POST /register`, `POST /login`, `GET /vault`, `PUT /vault`, `POST /password-change`, `GET /recovery/wrapped-key`, `POST /cert/renew`, `POST /cert/revoke`. (`/cert/renew` and `/cert/revoke` call an injectable `CaClient` interface; real `httpCaClient` HTTP implementation wired in `app.ts` once Phase 3's `pwm-ca` landed — see `lib/caClient.ts`.)
- [x] Session handling: opaque tokens, server-side session table, expiry. Rolling 90-day TTL per `API_SPEC.md`.
- [x] Rate limiting (`@fastify/rate-limit`) on the pre-session endpoints per spec.
- [x] Generic error responses — no username enumeration, no leaking which field failed on auth errors. Applied consistently to `/login/params`, `/login`, and `/recovery/wrapped-key` (the last one wasn't explicit in the spec but extended for consistency, see `docs/DECISIONS.md`).
- [x] `pino` structured logging per `MONITORING.md` — log the specified events, never log secrets.
- [x] Integration tests per `TESTING.md` — full request/response cycles against an ephemeral test DB. Used PGlite (WASM Postgres over a real socket) instead of Docker Postgres for local/CI runs, since no Docker was available — see `docs/DEPENDENCIES.md`. 24 tests passing across 2 files.
- [x] `Dockerfile` + `docker-compose.yml` (node-app + caddy + postgres) per `DEPLOY.md`.
- [x] Caddy config implementing mTLS `require_and_verify`, written as `infra/Caddyfile`. **Correction**: stock Caddy has no CRL/revocation directive (verified via web search) — revocation checking moved to the app layer instead (`requireSession` preHandler checks a forwarded `Client-Cert` header against the CRL + DB). See `docs/CA_SERVICE_SPEC.md` and `docs/DECISIONS.md` #17.

## Phase 3 — services/ca (CA signing service)

Follow `CA_SERVICE_SPEC.md` exactly.

- [x] Minimal Fastify (or Go, your call per spec) service: `/sign`, `/revoke`, `/crl`, `/health`. (Chose Fastify — reuse same stack/tooling as `packages/server`, per `DEPENDENCIES.md`. Not a pnpm workspace package; standalone npm-managed service with its own lockfile, wired into CI as a separate job.)
- [x] Flat-file storage: CA key/cert, `crl.json`, `issuance.log` — no DB. (Atomic write-then-rename for `crl.json` so a crash mid-write can't corrupt the revocation gate; append-only `issuance.log`.)
- [x] CSR validation (reject weak keys). Shells out to `openssl` (per `DEPENDENCIES.md`, avoids `node-forge`) — rejects RSA < 2048 bits and non-approved curves (only P-256/P-384/Ed25519/Ed448 accepted). Also validates the CSR's subject CN matches the request body's `deviceCn` before signing (extra check, not explicit in spec text, but prevents issuing a cert for an identity the caller didn't ask for).
- [x] systemd unit file for deployment (not Docker, per spec). `services/ca/deploy/pwm-ca.service`, hardened (`ProtectSystem=strict`, `NoNewPrivileges`, scoped `ReadWritePaths`).
- [x] Manual bootstrap script/runbook: generate CA keypair on-device, generate pwm-app's own client cert signed by it — document as a runbook since this step is deliberately manual. `services/ca/scripts/bootstrap.sh`.

## Phase 4 — packages/mobile (React Native, Android)

Follow `SCREENS_UX.md` and `DEPENDENCIES.md` exactly.

- [x] RN project scaffold, Android target only for now. RN 0.87.1, New Architecture
  (TurboModules) + Hermes, `com.pwm.mobile` package. No `ios/` dir at all (not just
  unused — never generated), per "Android target only for now."
- [x] Install + wire up: `zustand`, `react-native-get-random-values`. **Deviated**:
  skipped `react-native-ssl-pinning`/`react-native-biometrics`/`react-native-encrypted-storage`
  — wrote custom native modules instead (see below) so the BiometricPrompt is tightly
  coupled to the same Keystore `CryptoObject` end-to-end, and so storage/wrap/unwrap live
  in one coherent module instead of three separate libraries. **`react-native-ssl-pinning`
  (or equivalent mTLS client-cert networking) was never wired in** — `apiClient.ts` uses
  plain `fetch`, no client certificate presentation at all. This is a real gap, not done;
  the whole point of mTLS per `API_SPEC.md`/`THREAT_MODEL.md` is unmet on the client side.
- [x] Native Kotlin modules (two, not the one originally scoped):
  - `NativeKeystore` — Android Keystore wrap/unwrap, `setUserAuthenticationRequired(true)`,
    BiometricPrompt bound via `CryptoObject`, plus plain SharedPreferences storage for
    already-ciphertext/non-sensitive values (`android/app/src/main/java/com/pwm/mobile/nativemodules/KeystoreModule.kt`).
  - `NativeArgon2` — Argon2id via `argon2kt` (JNI binding over the same P-H-C reference C
    implementation the server's Node `argon2` binds to). **Not originally scoped** — found
    during implementation that Hermes can't run the Node `argon2` package
    `packages/core` uses server-side, so mobile needs its own native binding with an
    identical interface. See `docs/DECISIONS.md`.
  - Both verified by a real `./gradlew assembleDebug` success (not just typechecked) —
    Android SDK/NDK/cmake/JDK 17 installed this session specifically to verify this.
- [x] Screens, all 7, in spec order: `SetupScreen` (two-phase recovery display + blind
  last-6-characters confirmation implemented as written, not simplified to a checkbox),
  `LoginScreen`, `VaultListScreen`, `EntryDetailScreen`, `EntryEditScreen` (with password
  generator), `SettingsScreen`, `RecoveryScreen`. **`SettingsScreen`'s "manage devices/certs
  — list, revoke action per device" is NOT implemented** — "forget this device" only
  clears local state, does not call `/cert/revoke`; flagged inline in the component, not
  silently claimed done.
- [x] State stores: `authStore`, `vaultStore`, `settingsStore` per spec, plus two not in
  the original spec text: `vaultKeyStore` (the decrypted vaultKey itself needs to be
  shared across screens that don't otherwise touch vault state) and `syncLogic`/`idleTimer`
  as pure-function modules separated out specifically for unit testability.
- [x] App lifecycle: idle timer (configurable, `AppState` background/foreground), biometric
  gate on cold start, Keystore-backed encrypted disk cache (`sessionCache.ts`). Lock/unlock
  flow implemented in `App.tsx`.
- [x] Sync logic: revision comparison (`decideSyncAction`), pull wired into
  `VaultListScreen`'s pull-to-refresh; push-on-edit and true conflict-banner UI are minimal
  (`EntryEditScreen`/`EntryDetailScreen` mark local state dirty, but nothing currently
  calls `PUT /vault` to actually push — the sync loop's push half isn't wired to a
  screen/trigger yet). Last-write-wins policy function exists and is tested
  (`resolveConflictLastWriteWins`) but isn't wired to a real conflict UI banner.
- [x] Clipboard auto-clear timer on copy actions (`services/clipboard.ts`, wired into
  `EntryDetailScreen`'s Copy buttons).
- [ ] Cert renewal: **not implemented**. No background expiry check, no CSR generation, no
  call to `/cert/renew`, no cert install/rotation. Real remaining work, not attempted this
  phase given scope/time already spent on the rest of Phase 4.
- [x] Unit tests for pure logic (sync conflict resolution, password generator, idle timer)
  per `TESTING.md` — 37 tests across 7 files, including a full crypto-flow round-trip
  suite (`cryptoFlows.test.ts`) exercising real Argon2id/HKDF/AES-GCM against the actual
  server-side algorithms, not mocks.
- [ ] Manual QA checklist from `TESTING.md` — **not run**. No physical device/emulator
  available in this environment (only a real `./gradlew assembleDebug` build was
  possible); this remains a real pre-release gate, not satisfied by the automated tests
  above.

### Spec gaps found during Phase 4 implementation (see `docs/DECISIONS.md` #18-20)
- `#18`-adjacent: `packages/core`'s Argon2id implementation (native Node bindings) doesn't
  run in Hermes — required a second native Argon2id implementation (`argon2kt`) on mobile.
- `#19`: `POST /login`'s response was missing `userId`, which the client needs for the
  vault blob AAD on every decrypt — only `POST /register` returned it, once. Fixed
  server-side (`packages/server/src/routes/login.ts`), not a mobile-only workaround.
- `#20`: `RecoveryScreen`'s flow couldn't complete as spec'd — it ended by calling the
  session-required `/password-change`, but recovery by definition has no session. Added
  `POST /recovery/password-change` (no session required, same trust model as `GET
  /recovery/wrapped-key`) server-side.

## Phase 5 — cert bootstrap redesign + admin plane

Blocks Phase 6 (infra deploy) — do not start Phase 6 until this phase and the rest of Phase 4's open items are complete. This phase resolves a real architectural gap found after Phase 4 was mostly built: mTLS is enforced at the TLS layer (Caddy `require_and_verify`), so it cannot be bypassed per-route on a single listener — a brand-new device has no cert and therefore cannot reach ANY endpoint on a single mTLS-only listener, including the ones needed to get its first cert. Resolved design, worked out directly with the user:

- [x] **Two separate Caddy listeners/site-blocks** on `pwm-app`, both pointing at the same Fastify app (real separate TCP listeners/bind addresses, not a path-based rule — client cert verification happens at the TLS layer before Caddy can route by path). `infra/Caddyfile` rewritten; validated with the real `caddy validate` binary (installed this session specifically to verify this) — caught and fixed a real bug where Caddy's default directive-type precedence runs `respond` before `reverse_proxy` regardless of matchers, which would have silently 404'd every request on the LAN-only listener; fixed with explicit `route {}` blocks. Also migrated the deprecated `trusted_ca_cert_file` to `trust_pool`, caught by the same validation pass.
  - **LAN/VPN-only listener**: port 8443 (arbitrary, not security-significant), firewalled to `192.168.1.0/24` (this network has no separate VPN subnet — the OpenVPN CT bridges remote clients onto the same flat LAN), never port-forwarded on the router. Hosts exactly `POST /register` and `POST /cert/initial`.
  - **Port 443, public, full mTLS `require_and_verify`**: everything else.
- [x] `POST /register` (LAN-only) — gated by `registrationOpen`, auto-logs in on success (same shape `/login` returns), first-ever registered user becomes admin automatically inside the same DB transaction as the insert (race-safe against two simultaneous first registrations). `packages/server/src/routes/register.ts`.
- [x] `POST /cert/initial` (LAN-only, session-required, no existing-cert check) — `packages/server/src/routes/certInitial.ts`. Returns `{ cert, certId }`.
- [x] `users.is_admin BOOLEAN NOT NULL DEFAULT false`, `server_config.registration_open` — new Prisma migration (`20261015000000_admin_plane`), `CHECK` constraint + seed row added by hand to the generated SQL (Prisma's schema syntax has no native CHECK support). No hardcoded admin account.
- [x] `/admin/*` route group — `packages/server/src/routes/admin.ts`, new `requireAdmin` guard (`packages/server/src/lib/requireAdmin.ts`) checking session + `is_admin`, generic `403` for non-admin. All 4 routes implemented (`PATCH /admin/registration`, `GET /admin/users`, `POST /admin/certs/:certId/revoke`, `PATCH /admin/users/:id/admin`).
- [x] `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`, `docs/PROXMOX_NETWORK.md` updated before implementation, per the ground rules.
- [x] Mobile-side mTLS + cert lifecycle, the largest remaining piece — two new native Kotlin modules:
  - `NativeMtlsClient` (`android/app/src/main/java/com/pwm/mobile/nativemodules/MtlsClientModule.kt`) — OkHttp + a custom `X509ExtendedKeyManager` presenting a Keystore-backed client cert (separate Keystore alias from the vaultKey-wrap key, deliberately NOT `setUserAuthenticationRequired` — gating every HTTP request behind biometric would be unusable; this is a device-trust credential, not a vault-secrecy one). CSR generation via Bouncy Castle's `PKCS10CertificationRequestBuilder`, signed by a `ContentSigner` delegating to the Keystore-resident private key's own `Signature` object (the key never leaves the Keystore). Replaces the Keystore-generated self-signed placeholder cert with the real CA-signed one via `KeyStore.setKeyEntry` (officially supported per Android's own docs — the private key itself is never re-imported).
  - `packages/mobile/src/services/apiClient.ts` split into `createBootstrapApiClient` (plain TLS, LAN-only listener, `/register` + `/cert/initial` only) and `createApiClient` (real mTLS via the native module, everything else).
  - Cert renewal (`packages/mobile/src/services/certRenewal.ts`): checks expiry within a 14-day threshold, generates a new keypair+CSR, calls `/cert/renew`, installs the new cert, confirms it works with a real authenticated request, deletes the old Keystore alias, and calls `/cert/revoke` on the old cert — surfaced only as a toast (no dedicated screen), per `SCREENS_UX.md`. Checked from three places (`runCertRenewalCheck`, added in the second review pass per `DECISIONS.md` #24): `App.tsx`'s cold-start resume, its `AppState` foreground handler, and `LoginScreen.tsx`'s manual-login success — not just cold start.
  - `SettingsScreen`'s "forget this device" now actually calls `/cert/revoke` on the device's own active cert (previously only cleared local state).
  - Vault push-sync wired for real: `EntryEditScreen`'s save and `EntryDetailScreen`'s delete now call a new `pushVaultIfDirty()` (`packages/mobile/src/services/vaultSync.ts`), which calls `PUT /vault`, serializes overlapping calls onto a module-level in-flight promise (`DECISIONS.md` #24), and handles the `409` conflict case (last-write-wins: pulls the server's copy, overwrites local, surfaces a warning) — previously edits only marked `dirty` and nothing ever pushed.
  - `SetupScreen.tsx` resumes correctly if `/cert/initial` fails or the app crashes right after `/register` succeeds, instead of dead-ending on a 409 (`DECISIONS.md` #24) — the session is persisted before `/cert/initial` is attempted and a dedicated resume step retries only that call.
  - Verified with real `./gradlew assembleDebug` AND `assembleRelease` success (both, not just one) after every change in this phase, not just typechecked.
- [x] Fixed the 5 confirmed correctness/resource findings from the Phase 1-4 code reviews: RFC2253 DN parser's `+` handling in `services/ca/src/openssl.ts` (added multi-valued-RDN regression tests), uncaught startup crash on missing CA cert files in `packages/server/src/app.ts` (now `log.fatal` + `process.exit(1)`, matching every other startup failure path), `config.port` getter thrown outside the only try/catch in `services/ca/src/index.ts`, `PORT` env validation accepting hex/exponential/negative strings in `services/ca/src/config.ts` (strict decimal regex + 1-65535 range, regression tests for each case), and the never-closed undici Agent in `packages/server/src/lib/caClient.ts` (`CaClient.close()`, wired into `app.ts`'s `onClose` hooks).
- [ ] The manual QA checklist from `TESTING.md`, run end-to-end on a real device against a deployed backend — **not done**, no physical device/emulator or deployed backend available in this environment. Real pre-release gate, not satisfied by the automated tests/builds above.

### Spec gaps found during Phase 5 implementation (see `docs/DECISIONS.md` #22-24)
- `#22`: the cert-bootstrap deadlock itself (mTLS is TLS-layer, can't be bypassed per-route on one listener) and the no-hardcoded-admin-account resolution — the whole two-listener/admin-plane design this phase implements.
- `#23`: `POST /cert/renew`'s response was missing `certId` (same class of gap as `#19`'s missing `userId` in `/login`) — the device needs its own cert's `certId` to later call `/cert/revoke` on itself. Fixed server-side.
- `#24`: second code-review pass, 4 findings, all fixed — `SetupScreen.tsx`'s register/cert-initial dead end, cert renewal only running at cold start, cert log events using `fingerprint` instead of the `certId` row id, and `vaultSync.ts`'s missing in-flight guard.

## Phase 6 — infra / deployment

Per `PROXMOX_NETWORK.md`, `BACKUP.md`, `MONITORING.md`, `DEPLOY.md`. Proxmox access: see memory (SSH key at `~/.ssh/pwm_proxmox`, host `192.168.1.254`, requires VPN connected) — ask the user to confirm VPN is up before attempting SSH. Do not start this phase until Phase 5 is fully complete and confirmed.

- [x] Create `pwm-app` VM/LXC, static IP `192.168.1.10`. (CT 201, Docker-in-LXC.)
- [x] Create `pwm-ca` LXC, static IP `192.168.1.11`. (CT 202.)
- [x] Write and apply Proxmox firewall rules (`/etc/pve/firewall/<vmid>.fw`) for both, allow-list per `PROXMOX_NETWORK.md` (including the LAN-only listener's restricted firewall rule from Phase 5) — confirmed with user before applying; verified live via direct connectivity tests (host SSH unaffected, both CTs correctly allow/deny per the rules).
- [x] Add router port-forward: TCP 443 → `192.168.1.10:443`. User confirmed done on their own router.
- [x] Bootstrap CA on `pwm-ca`. Re-bootstrapped once more mid-session as ECDSA P-256 (was Ed25519 — see `docs/DECISIONS.md` #29, a real Android device's TLS stack never offers ed25519 in its ClientHello).
- [x] Deploy `pwm-app` containers via `docker compose up -d`. Found and fixed 3 real bugs only visible from an actual running deploy, not just a successful build (`docs/DECISIONS.md` #25-27): services/ca had no TLS at all, the Dockerfile's `prisma generate` step, and `crlPoller.ts`'s unauthenticated fetch. Then found and fixed 4 more real bugs only visible from an actual real-device end-to-end test (`docs/DECISIONS.md` #28-32): the LAN-only listener's self-signed cert (added app-side pinning), the Ed25519 CA itself, a Keystore digest-authorization gap, a session-token bug in the mobile app's login flow, and two missing Hermes JS-engine globals. Full register → save password → logout → login → vault-with-data cycle confirmed working end to end on the user's real phone.
- [x] Set up backup cron jobs per `BACKUP.md` (DB dump daily, `vzdump` weekly for both VM/LXC). `infra/backup-db.sh` (CT 201, daily 3am) and `infra/backup-ca.sh` (CT 202, weekly Sun 4am) installed via cron, age-encrypted, manually test-run and verified on both — real backup files produced, decryption round-tripped successfully with the offline private key. `infra/restore-db.sh` written, not yet exercised (see restore drill below). Found the backup-drive path assumption (`/mnt/backup-drive/...`) didn't match reality — real drive is `/backups` on the Proxmox host (separate `sda4` partition, already used for `vzdump`) — fixed via `pct set <id> -mpX` bind mounts into each container (`/backups/pwm/db` → CT 201, `/backups/pwm/ca` → CT 202), with ownership corrected for each container's unprivileged UID mapping (host UID 100000 = container root). age identity generated offline on the user's own machine, private key kept there (not on either CT), only the public key (`age1390mme...`) deployed. `infra/pwm-logrotate.conf` installed on CT 201. Also fixed a real bug found along the way: `docker-compose.yml`'s Caddy service had no bind mount for `/var/log/caddy/` (the path `infra/Caddyfile`'s `log` blocks write to) — logs were being silently lost on every container recreate; added the mount, verified log files now persist on the host.
- [x] Log rotation — done above, folded into the same pass (`infra/pwm-logrotate.conf`).
- [ ] Uptime check — explicitly skipped per user ("no need for uptime monitoring"). Not doing this for v1.
- [ ] **Run a restore drill** — not yet done, deliberately deferred by the user ("the drill can wait"). A real encrypted backup already exists and was confirmed decryptable with the offline key, so the pipeline is proven at the crypto level; the actual `restore-db.sh` end-to-end run (decrypt + `psql` restore into a real/test target) is the piece still outstanding. Don't let this slip indefinitely — it's the one BACKUP.md explicitly says not to skip.

## Phase 7 — in-app update mechanism (v1.1, deferred — not blocking v1 release)

Not part of v1 scope. Documented now so the design is captured while fresh; implement
after Phase 6 is fully confirmed stable on real infra.

**Problem**: this is a sideloaded app (no Play Store, by design — open source,
self-hosted). Any code change (UI or native) currently requires a manual rebuild +
reinstall via adb. Fine for 2 users during active development, not fine for any
self-hoster running this for a real user base — "redo adb install for 300 phones" isn't
a real update story.

**Design, resolved after discussion with the user**:
- **Not GitHub Releases** — a self-hoster forking this repo has their own users, their
  own backend, their own signing key. Pointing updates at the upstream repo's releases
  would be wrong (wrong binary, wrong trust anchor) and would leak "who's running this
  fork" telemetry to the upstream maintainer, which the user explicitly doesn't want
  ("they are not supposed to use my data").
- **Not a separate updater app** — Android requires a human tap to confirm any APK
  install regardless of which app initiates it (OS-level protection, no way around this
  without root/system-app privileges, which is out of scope). A second app doesn't
  remove that tap, just relocates it, while adding install-permission attack surface and
  a second thing to install. Rejected.
- **Chosen**: each self-hoster's own backend (the one every deployed app build is
  already pointed at, via `SERVER_URL`/`BOOTSTRAP_URL` from Phase 5's `.env` work) serves
  its own update check + APK, over the same mTLS connection the app already trusts — no
  new trust setup, no shared infra between deployments, scales identically whether it's
  serving 2 users or 300.
- **APK publishing mechanism, resolved after further discussion**: not an admin-upload
  API endpoint — a committed `scripts/deploy-apk.sh` (+ `.env.example`, gitignored real
  `.env`, same convention as mobile/server's own) that scp's the built APK to pwm-app and
  writes `version.json` in the same run. `GET /app/version`/`GET /app/apk` just read
  static files from a known directory (`APP_RELEASES_DIR` env var) — no upload handler,
  no multipart parsing, no admin-auth-gated write path to secure server-side.

**Scope**:
- [x] `GET /app/version` (mTLS listener, session required) — returns latest available
  `versionCode`/`versionName` the backend has on file. `packages/server/src/routes/appVersion.ts`,
  reads `version.json` from `APP_RELEASES_DIR` (default `/etc/pwm-app-releases`).
- [x] `GET /app/apk` (mTLS listener, session required) — streams `app-release.apk` from
  the same directory. `packages/server/src/routes/appApk.ts`.
- [x] `scripts/deploy-apk.sh` + `scripts/.env.example` — scp's the APK + atomically
  writes `version.json` to pwm-app over SSH, in one run.
- [x] Client: on launch/foreground (and manual login), check `/app/version` against the
  installed app's own `versionCode` via a new tiny native module (`NativeAppInfo`,
  `getInstalledVersionCode()` via `PackageManager` — no `react-native-device-info`
  dependency pulled in for one field). If server's newer, show a dismissible,
  non-blocking banner (`UpdateBanner.tsx`), not a forced update.
- [x] On tap: download APK via `/app/apk` (same authenticated mTLS connection — a new
  `downloadToFile()` native method streams straight to disk rather than round-tripping a
  multi-megabyte binary through the JS bridge as a string), then trigger Android's
  standard install flow (`NativeAppInfo.installApk()`: `Intent.ACTION_VIEW` on a
  `FileProvider` `content://` Uri, `REQUEST_INSTALL_PACKAGES` permission added to the
  manifest). User gets the normal OS "Install this update?" confirmation — one tap, not
  automatable further, not bypassed.
- [ ] **Verified on a real device**: since package name + release signing key stay
  constant across versions, this should be a normal Android app update, not a fresh
  install — local data (Keystore mTLS cert, session, vault cache) should persist
  automatically, no re-register/re-login/re-pairing needed. Not yet confirmed with a real
  `deploy-apk.sh` run + an actual on-device tap-to-update — the whole flow is built and
  unit-tested, but (per this project's own `docs/DECISIONS.md` #25-32 track record) a
  real device is what actually proves something like this works. Do this before calling
  Phase 7 done.
- [x] Documented the self-hoster's release process in `docs/DEPLOY.md`.

## Ground rules for the implementing agent

- Never commit real certs, keys, `.env` files, or any secret material — check `git status` before every commit.
- Never invent crypto parameters, endpoint shapes, or schema fields not in the specs — if a spec is ambiguous or missing something, stop and ask the user rather than guessing, especially for `packages/core`.
- Any infra change that touches the live Proxmox host, router, or DNS is a **confirm-before-acting** action — these affect the user's real home network, not just this repo.
- Keep `DECISIONS.md`'s "Deferred to v2" list untouched — do not implement autofill, TOTP, folders, desktop/iOS clients, or per-item sync in v1 scope, even if it seems easy to add while touching related code.
- Write tests alongside code, not after — especially for `packages/core`, per `TESTING.md`.
