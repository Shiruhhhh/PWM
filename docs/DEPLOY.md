# PWM — Deploy & CI/CD Spec

## pwm-app deployment

- **Docker**, per project decision. `docker-compose.yml` on the VM, two services:
  - `caddy` — reverse proxy, TLS + mTLS termination, mounts server/client certs and CRL.
  - `node-app` — the Fastify backend, connects to DB (Postgres container too, or external if preferred — containerized Postgres simplest for 2-user scale).
- Image built via CI (GitHub Actions), pushed to a container registry (GitHub Container Registry — free, integrates cleanly with a GitHub-hosted open-source repo), pulled on the VM.
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
