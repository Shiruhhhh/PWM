# PWM

Self-hosted, zero-knowledge password manager. Android client (v1), Node backend, mutual-TLS authenticated, built as a learning project and released open source.

> **Status**: planning phase. No code yet — see docs below for full design.

## Why

Built to learn applied cryptography, secure protocol design, and cross-platform app development end to end — not a replacement recommendation over audited tools like Bitwarden/Vaultwarden for general use. See [THREAT_MODEL.md](./docs/THREAT_MODEL.md) for an honest account of what this does and doesn't protect against.

## Design docs

All design docs live in [`docs/`](./docs). Implementation tasks are tracked in [TASKS.md](./TASKS.md).

- [CRYPTO_SPEC.md](./docs/CRYPTO_SPEC.md) — key derivation, encryption, recovery, versioning
- [API_SPEC.md](./docs/API_SPEC.md) — backend endpoints
- [DB_SCHEMA.md](./docs/DB_SCHEMA.md) — database schema
- [SCREENS_UX.md](./docs/SCREENS_UX.md) — mobile app screens and flows
- [CA_SERVICE_SPEC.md](./docs/CA_SERVICE_SPEC.md) — internal CA signing service for client certs
- [PROXMOX_NETWORK.md](./docs/PROXMOX_NETWORK.md) — self-hosted network/firewall layout
- [BACKUP.md](./docs/BACKUP.md) — backup and disaster recovery
- [MONITORING.md](./docs/MONITORING.md) — logging and alerting
- [TESTING.md](./docs/TESTING.md) — test strategy
- [DEPLOY.md](./docs/DEPLOY.md) — deployment and CI/CD
- [DEPENDENCIES.md](./docs/DEPENDENCIES.md) — library choices
- [DECISIONS.md](./docs/DECISIONS.md) — open design decisions and their resolutions
- [THREAT_MODEL.md](./docs/THREAT_MODEL.md) — security scope and limitations

## Scope (v1)

- Multiple independent users, each with their own fully isolated vault (no sharing/organizations).
- Android client only — desktop (Electron) and iOS explicitly deferred.
- Autofill explicitly deferred to a later version.
- Self-hosted only — no hosted/SaaS offering.

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

Not independently security-audited. See [THREAT_MODEL.md](./docs/THREAT_MODEL.md) before using for anything you can't afford to lose.
