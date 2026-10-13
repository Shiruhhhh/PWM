# PWM — Testing Strategy

## packages/core (highest priority — crypto correctness)

- **Known-answer tests (KAT)**: fixed input → expected output, for Argon2id, HKDF-SHA256, AES-256-GCM. Catches implementation drift/regression immediately.
- **Round-trip tests**: encrypt→decrypt, wrap→unwrap (both password-derived and recovery-key paths), confirm original data recovered exactly.
- **Negative tests**: tampered ciphertext/authTag → must fail to decrypt (GCM auth failure), wrong key → must fail, reused nonce detection if feasible to test.
- **Domain separation test**: confirm `vaultKey` and `authKey` derived from same `masterKey` are different and one cannot be derived from the other without the original `masterKey`.
- Tooling: `vitest`.

## packages/server

- **Unit tests**: route handlers in isolation (mock DB), especially revision-conflict logic on `PUT /vault`, auth-hash comparison (constant-time, no early-return timing leak), rate-limit behavior.
- **Integration tests**: spin up test DB (SQLite in-memory or ephemeral Postgres container), full request/response cycle through Fastify, covering: register → login → vault read/write → password-change → recovery flow end-to-end.
- **mTLS tests**: separate from unit tests — verify Caddy config actually rejects no-cert/invalid-cert/revoked-cert requests (can't easily unit test Caddy itself, treat as a manual or scripted smoke test against a real Caddy instance in CI or pre-deploy).

## packages/mobile

- **Unit tests**: pure logic (sync conflict resolution, password generator charset logic, idle-timer logic) — `jest` + RN testing utilities, no device needed.
- **Native module tests**: Keystore wrap/unwrap, biometric gate — hard to unit test meaningfully (depends on real Android hardware/Keystore), rely on manual device testing for these, documented as a manual QA checklist rather than automated.
- **Manual QA checklist** (run before each release): setup flow incl. blind recovery-key confirmation, login, biometric unlock, idle lock/relock, add/edit/delete entry, copy-to-clipboard auto-clear, sync across 2 devices (conflict scenario), password change, recovery flow, cert renewal (simulate near-expiry), cert revoke.

## CI (GitHub Actions)

- Trigger: every PR + push to main.
- Jobs:
  1. **Lint** — eslint + prettier check, fails on violations.
  2. **Core tests** — `vitest run` on `packages/core`, must pass, this is the non-negotiable gate (crypto correctness).
  3. **Server tests** — unit + integration tests against ephemeral test DB.
  4. **Mobile unit tests** — `jest` on `packages/mobile` pure-logic tests only (no device/emulator in CI for v1 — Android emulator CI is possible but heavy, defer).
  5. **Build check** — TypeScript compiles clean across all packages, RN app bundles successfully.
- Branch protection: require CI green before merge to main (once repo is public, this also signals quality to anyone evaluating the project).

## Out of scope for v1

- Automated RN emulator/device testing in CI (Detox or similar) — valuable but heavy setup cost relative to 2-user project scale, defer to later if project grows.
- Fuzz testing on crypto core — worth considering eventually given CV/security-showcase goal, explicitly deferred rather than silently skipped.
