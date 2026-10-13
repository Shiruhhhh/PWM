# PWM — Backup & Disaster Recovery Spec

Goal: survive VM/LXC loss, disk failure, or Proxmox host failure without losing vault data or the ability to issue/revoke certs. Using the dedicated backup drive already attached to the Proxmox host.

## What gets backed up

### 1. DB dump (pwm-app) — frequent, small
- Scope: `users`, `vault_blobs`, `sessions` (sessions optional, cheap to exclude and just force re-login after restore), `client_certs` tables.
- Method: `pg_dump` (or SQLite file copy) → encrypted with a separate backup-encryption key (not the vault's own crypto — this is an extra layer protecting the dump file at rest on the backup drive) → written to backup drive.
- Frequency: daily, cron on pwm-app.
- Retention: keep last 14 daily + last 6 monthly (simple rotation).
- Note: `vault_blobs.encrypted_blob` is already end-to-end encrypted — even an unencrypted dump wouldn't leak vault contents — but `auth_hash`/salts/wrapped keys still warrant care, so encrypt the dump anyway as defense in depth.

### 2. Full VM/LXC snapshot (pwm-app) — less frequent, larger
- Method: Proxmox's own `vzdump` to the backup drive's storage target.
- Frequency: weekly.
- Retention: keep last 4 weekly + last 3 monthly.
- Covers: full OS/app state, not just data — fastest path to "stand the whole thing back up exactly as it was" after a VM-level disaster (corrupted disk, failed upgrade, etc).

### 3. CA signing LXC data (pwm-ca) — critical, infrequent changes
- Scope: `ca.key`, `ca.crt`, `crl.json`, `issuance.log`.
- Method: encrypted tar of `/etc/pwm-ca/` → backup drive. Also covered by weekly `vzdump` snapshot of the whole LXC (belt-and-suspenders, since this is the single hardest-to-recover piece — losing `ca.key` with no backup means every future cert renewal/revocation is permanently impossible, though already-issued certs keep working until they individually expire).
- Frequency: weekly (matches LXC's low churn), plus triggered backup right after initial bootstrap (the one moment `ca.key` is created).
- Retention: keep last 4 weekly + indefinite copy of the very first post-bootstrap backup (extra safety net for the one irreplaceable artifact in the whole system).

## Encryption of backups themselves

- Dumps/tars encrypted with a backup-specific symmetric key (e.g. age or gpg, your choice) — key itself stored offline (same place you'd keep the recovery-key equivalent for your own master password: not on any VM, not on the backup drive itself).
- Rationale: backup drive theft/failure shouldn't hand an attacker the CA key or auth hashes in plaintext, even though vault contents are already separately encrypted.

## Restore procedure (documented, tested at least once before relying on it)

1. **Data-only loss** (DB corrupted, app VM fine): stop app, restore latest DB dump, decrypt, import, restart. RPO: up to 24h (daily dump interval).
2. **Full VM loss**: restore latest `vzdump` snapshot via Proxmox, then layer latest DB dump on top if newer than the snapshot's own data. RPO: up to 7 days for the snapshot baseline, up to 24h once DB dump layered in.
3. **CA LXC loss**: restore latest `vzdump` snapshot or decrypt the `/etc/pwm-ca/` tar onto a fresh LXC. Existing client certs keep working regardless (they don't depend on pwm-ca being up, only renewal/revocation do) — so this is less urgent than pwm-app loss, but still plan to restore within the 90-day cert lifetime window to avoid a renewal gap.

## Action item

Actually run a restore drill once initial deployment exists — an untested backup is not a backup. Add this as a checklist item for post-implementation, not something to defer indefinitely.
