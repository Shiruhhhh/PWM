# PWM — Dependency List (v1)

Pin exact versions at implementation time, check for maintenance status/known CVEs before locking.

## packages/core (shared TS, crypto + API types)

- `argon2` — Argon2id KDF, native bindings (avoid pure-JS implementations, too slow + risk of side-channel timing issues).
- `@noble/hashes` (or Node's built-in `crypto` where sufficient) — HKDF-SHA256, SHA-256.
- `@noble/ciphers` (or Node's built-in `crypto`) — AES-256-GCM.
- `zod` — runtime schema validation for vault blob JSON + API payloads, shared between client/server.
- TypeScript, no runtime framework dependency — this package should stay pure logic, portable to RN and Node both.

## packages/server (Node backend)

- `fastify` — HTTP framework, lighter than Express, built-in schema validation (pairs with `zod` via `fastify-type-provider-zod`).
- `pg` or `better-sqlite3` — DB driver (SQLite acceptable at 2-user scale, Postgres if you want headroom/familiarity).
- `prisma` (optional) — ORM/migrations, worth it even at small scale for schema migration discipline.
- `argon2` — same package as core, used for server-side second-pass hashing of `authHash`.
- `@fastify/rate-limit` — per-IP/per-username throttling on `/login`, `/register`, `/login/params`, `/recovery/wrapped-key`.
- `pino` (bundled with Fastify) — structured logging, feeds into decision #11 (basic log review/monitoring).
- `@electric-sql/pglite` + `@electric-sql/pglite-socket` (dev-only) — WASM Postgres exposed over a real TCP socket for integration tests, per `TESTING.md`'s "SQLite in-memory or ephemeral Postgres container" — gives real Postgres semantics (JSONB, UUID, BYTEA) without Docker, so Prisma connects via a normal `DATABASE_URL` with no code changes. CI/production integration tests still target a real Postgres container.

## packages/mobile (React Native, Android)

- `react-native` — core framework.
- `zustand` — state management.
- `react-native-ssl-pinning` — client cert (mTLS) + pinning support for networking. Fallback: custom native module around OkHttp if this proves insufficient.
- `react-native-biometrics` — BiometricPrompt integration.
- `react-native-encrypted-storage` — Keystore-backed local storage for wrapped vault blob cache + settings.
- `react-native-get-random-values` — polyfill for `crypto.getRandomValues`, required before any `@noble/*` crypto calls work correctly in RN JS runtime (Hermes lacks native WebCrypto). Must be imported first, before anything else, in `index.js`.
- `react-native-config` — bakes `packages/mobile/.env` (gitignored; see `.env.example`) into the compiled app at build time, exposed in JS as `Config.SERVER_URL`/`Config.BOOTSTRAP_URL`. Used as the default server address so a normal install never needs manual configuration; overridable at runtime via an "advanced" field on LoginScreen/SetupScreen, stored through the existing `nativeStorage` mechanism (not plain AsyncStorage).
- `react-native-keychain` (alternative/companion to encrypted-storage, evaluate overlap — may only need one of the two).
- Native Kotlin module (custom, no npm package) — Android Keystore key generation/wrap/unwrap with `setUserAuthenticationRequired(true)`, exposed to JS via RN bridge.

## CA signing service (LXC, minimal)

- Node + `fastify` (reuse same stack, keep footprint small) OR a tiny Go binary if you want to practice Go — either fine, service is simple (sign CSR, maintain CRL, revoke).
- `node-forge` or Node's built-in `crypto`/OpenSSL CLI shelled out — for CSR signing operations.
- No DB needed — flat CRL file + append-only issuance log (plain JSON/text file) sufficient at this scale.

## Infra (not npm packages, but part of stack)

- **Caddy** — reverse proxy, TLS termination, mTLS enforcement (`client_auth` / `require_and_verify`), auto Let's Encrypt renewal.
- **OpenSSL** — initial CA + cert generation tooling (one-time bootstrap, manual).
- **Proxmox** — VM (app backend) + LXC (CA signing service), existing host.

## Dev tooling

- `pnpm` (workspaces) — monorepo package manager, faster/stricter than npm for this structure.
- `vitest` or `jest` — unit tests, especially crypto core (known-answer/test-vector tests for Argon2id, HKDF, AES-GCM round-trips).
- `eslint` + `prettier` — code quality consistency, matters for open-source/CV presentation.
- GitHub Actions — CI running tests on PR (decision #13/CV-quality signal from earlier discussion).

## Explicitly avoided

- `Math.random()` anywhere near crypto paths — never cryptographically secure.
- Pure-JS Argon2 implementations — too slow, use native bindings.
- Plain `AsyncStorage` for anything sensitive — not encrypted at rest.
- Redux — unnecessary complexity at this app's state size.
