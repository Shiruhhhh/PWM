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