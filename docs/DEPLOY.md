# PWM — Deploy & CI/CD Spec

## pwm-app deployment

- **Docker**, per project decision. `docker-compose.yml` on the VM/LXC, three services:
  - `caddy` — reverse proxy, TLS + mTLS termination. Exposes both 443 (public) and 8443
    (LAN-only, per `docs/DECISIONS.md` #22's two-listener design — the Proxmox firewall,
    not Caddy or Docker, is what actually keeps 8443 off the public internet). Trusts the
    internal CA via a bind mount of the host's `/etc/pwm-app-cert/ca.crt` (placed there by
    the CA bootstrap runbook, `services/ca/scripts/bootstrap.sh`'s step 2) into
    `/etc/pwm/ca.crt`, matching `infra/Caddyfile`'s `trust_pool file` path.
  - `node-app` — the Fastify backend. Also bind-mounts `/etc/pwm-app-cert` (same directory
    Caddy reads from) read-only, and reads `CA_CLIENT_CERT_PATH`/`CA_CLIENT_KEY_PATH`/
    `CA_TRUST_CERT_PATH` pointing into it — these are the files from the bootstrap
    runbook's step 2 (pwm-app's own CA-signed client cert, for authenticating to pwm-ca's
    `/sign`/`/revoke`/`/crl`), not the end-user mTLS certs (those are per-device, issued
    at runtime via `/cert/initial`/`/cert/renew`, never baked into the container).
  - `postgres` — containerized, simplest for 2-user scale; `DATABASE_URL` points at it by
    service name.
  - `node-app`'s container `CMD` runs `prisma migrate deploy` before starting the server,
    on every container start — idempotent (no-op if already applied), so this needs no
    separate manual migration step. Picks up both Prisma-generated and hand-added SQL
    (`CHECK` constraints, seed `INSERT`s) in each migration folder, since `migrate deploy`
    just applies each `migration.sql` as-is.
- Image built via CI (GitHub Actions), pushed to a container registry (GitHub Container
  Registry — free, integrates cleanly with a GitHub-hosted open-source repo), pulled on
  the VM once a version tag has been cut and `release.yml` has run at least once. Before
  the first tag exists, `docker compose build` (the `build:` block already in
  `docker-compose.yml`) builds `node-app` locally on the host instead of pulling.
- Deploy trigger: manual `docker compose pull && docker compose up -d` run by you over SSH, OR a simple webhook/script triggered on new image publish — **manual recommended for v1** (2-user project, infrequent deploys, auto-deploy adds complexity/risk — e.g. an untested push rolling straight to the VM that holds your actual passwords). Revisit automated deploy only if release cadence picks up.

## pwm-ca deployment

- Plain systemd service (per CA_SERVICE_SPEC.md — no Docker here, deliberately kept bare/simple/low-churn).
- Deployed via a small deploy script (copy binary/code, restart systemd unit) — infrequent, manual, matches the service's rare-change nature.

## CI pipeline (GitHub Actions)

```
.github/workflows/ci.yml       # lint, test, build — every PR/push (see TESTING.md)
.github/workflows/release.yml  # on tag/release: build + push Docker image to GHCR
```

- `ci.yml`: lint → core tests → server tests → mobile unit tests → build check. Must pass before merge (branch protection).
- `release.yml`: triggered on version tag (e.g. `v1.0.0`), builds `node-app` Docker image, pushes to `ghcr.io/<you>/pwm-app:latest` and `:v1.0.0`. Does not auto-deploy to your VM — you pull manually.

## Environment/secrets handling

- `.env.example` committed, real `.env` gitignored — never commit DDNS hostname, actual cert paths, DB credentials.
- GitHub Actions secrets (if any needed, e.g. for GHCR push auth) stored in repo's Actions secrets, never in code.
- Self-hoster setup docs (SETUP.md, still to write) walk through generating your own `.env` from the example.

## Versioning

- Semantic versioning (`v1.0.0` etc) once first stable release cut.
- `cryptoSchemeVersion` / `blobFormatVersion` (from CRYPTO_SPEC.md) are independent of app release version — app version can bump without forcing a crypto/blob migration, and vice versa in rare cases.
