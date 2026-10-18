# PWM

Self-hosted, zero-knowledge password manager. Android client, Node backend, mutual-TLS
authenticated, built as a learning project and released open source.

> **Status**: v1 built, deployed, and running in production on the author's own
> infrastructure — register/login/vault sync confirmed working end to end on a real
> Android device, over both LAN and mobile data. Backups and log rotation are live.
> Still outstanding before calling this fully "done": a restore drill (deliberately
> deferred, not forgotten — see [TASKS.md](./TASKS.md) Phase 6) and the in-app update
> mechanism (Phase 7, v1.1).

## Why

Built to learn applied cryptography, secure protocol design, and cross-platform app
development end to end — not a replacement recommendation over audited tools like
Bitwarden/Vaultwarden for general use. See [THREAT_MODEL.md](./docs/THREAT_MODEL.md)
for an honest account of what this does and doesn't protect against.

## Getting started

Standing up your own instance (backend + CA service + mobile app) is covered in
**[docs/INSTALL.md](./docs/INSTALL.md)**.

## Repo layout

- `packages/core` — shared crypto/KDF/encoding library (TypeScript, used by both server and mobile).
- `packages/server` — Node/Fastify backend (accounts, vault storage, sessions).
- `packages/mobile` — React Native Android client.
- `services/ca` — standalone internal CA signing service for mTLS client certs (separate deployable, not a workspace package).
- `infra/` — Caddy config, backup/log-rotation scripts, Docker Compose deployment.

## Design docs

All design docs live in [`docs/`](./docs). Implementation tasks are tracked in [TASKS.md](./TASKS.md).

- [INSTALL.md](./docs/INSTALL.md) — self-hoster installation guide, start here if you want to run your own instance
- [CRYPTO_SPEC.md](./docs/CRYPTO_SPEC.md) — key derivation, encryption, recovery, versioning
- [API_SPEC.md](./docs/API_SPEC.md) — backend endpoints
- [DB_SCHEMA.md](./docs/DB_SCHEMA.md) — database schema
- [SCREENS_UX.md](./docs/SCREENS_UX.md) — mobile app screens and flows
- [CA_SERVICE_SPEC.md](./docs/CA_SERVICE_SPEC.md) — internal CA signing service for client certs
- [PROXMOX_NETWORK.md](./docs/PROXMOX_NETWORK.md) — self-hosted network/firewall layout
- [BACKUP.md](./docs/BACKUP.md) — backup and disaster recovery
- [MONITORING.md](./docs/MONITORING.md) — logging and alerting
- [TESTING.md](./docs/TESTING.md) — test strategy
- [DEPLOY.md](./docs/DEPLOY.md) — deployment and CI/CD, including backup/log-rotation setup
- [DEPENDENCIES.md](./docs/DEPENDENCIES.md) — library choices
- [DECISIONS.md](./docs/DECISIONS.md) — design decisions, including real bugs found deploying to production and how they were fixed
- [THREAT_MODEL.md](./docs/THREAT_MODEL.md) — security scope and limitations

## Scope (v1)

- Multiple independent users, each with their own fully isolated vault (no sharing/organizations).
- Android client only — desktop (Electron) and iOS explicitly deferred.
- Autofill explicitly deferred to a later version.
- Self-hosted only — no hosted/SaaS offering.
- No Play Store distribution — sideloaded APK, your own signing key (see [INSTALL.md](./docs/INSTALL.md)). In-app update checking is deferred to v1.1 ([TASKS.md](./TASKS.md) Phase 7); for now, updating means rebuilding and reinstalling the APK.

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

Not independently security-audited. See [THREAT_MODEL.md](./docs/THREAT_MODEL.md) before using for anything you can't afford to lose.
