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

## Phase 5 — infra / deployment

Per `PROXMOX_NETWORK.md`, `BACKUP.md`, `MONITORING.md`, `DEPLOY.md`. Proxmox access: see memory (SSH key at `~/.ssh/pwm_proxmox`, host `192.168.1.254`, requires VPN connected) — ask the user to confirm VPN is up before attempting SSH.

- [ ] Create `pwm-app` VM/LXC, static IP `192.168.1.10`.
- [ ] Create `pwm-ca` LXC, static IP `192.168.1.11`.
- [ ] Write and apply Proxmox firewall rules (`/etc/pve/firewall/<vmid>.fw`) for both, allow-list per `PROXMOX_NETWORK.md` — confirm with user before applying, this changes live infra.
- [ ] Add router port-forward: TCP 443 → `192.168.1.10:443`. **This is a user action on their router — confirm with user, don't assume remote access to the router itself.**
- [ ] Bootstrap CA on `pwm-ca` (manual step, see Phase 3 runbook).
- [ ] Deploy `pwm-app` containers via `docker compose up -d`.
- [ ] Set up backup cron jobs per `BACKUP.md` (DB dump daily, `vzdump` weekly for both VM/LXC).
- [ ] Set up basic uptime check + log rotation per `MONITORING.md`.
- [ ] **Run a restore drill** — don't skip this, per `BACKUP.md` explicit action item.

## Ground rules for the implementing agent

- Never commit real certs, keys, `.env` files, or any secret material — check `git status` before every commit.
- Never invent crypto parameters, endpoint shapes, or schema fields not in the specs — if a spec is ambiguous or missing something, stop and ask the user rather than guessing, especially for `packages/core`.
- Any infra change that touches the live Proxmox host, router, or DNS is a **confirm-before-acting** action — these affect the user's real home network, not just this repo.
- Keep `DECISIONS.md`'s "Deferred to v2" list untouched — do not implement autofill, TOTP, folders, desktop/iOS clients, or per-item sync in v1 scope, even if it seems easy to add while touching related code.
- Write tests alongside code, not after — especially for `packages/core`, per `TESTING.md`.
