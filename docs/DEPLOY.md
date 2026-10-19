# PWM — Deploy & CI/CD Spec

## Reverse proxy (pwm-proxy, CT 200) deployment

Per `docs/DECISIONS.md`'s reverse-proxy migration entry — Caddy no longer runs on
pwm-app. It runs on its own shared LXC, `pwm-proxy`, since a router can only forward port
443 to one internal IP and this host fronts more than one self-hosted project.

- `infra/caddy/docker-compose.yml` — one service, `caddy`. Exposes both 443 (public) and
  8443 (LAN-only, per `docs/DECISIONS.md` #22's two-listener design — the Proxmox
  firewall, not Caddy or Docker, is what actually keeps 8443 off the public internet).
  Trusts the internal CA via a bind mount of the host's `/etc/pwm-proxy-cert/ca.crt` into
  `/etc/pwm/ca.crt`, matching `infra/caddy/Caddyfile`'s `trust_pool file` path.
- `infra/caddy/Caddyfile` reverse-proxies to pwm-app over the LAN
  (`192.168.1.10:3000`) — a real network hop, not Docker Compose service-name
  resolution, since Caddy and `node-app` no longer share a Docker network.
- Deploy: copy `infra/caddy/` to pwm-proxy, fill in its own `.env` (`PWM_PUBLIC_HOST`,
  same value as pwm-app's), `docker compose up -d`.

## pwm-app deployment

- **Docker**, per project decision. `docker-compose.yml` on CT 201, two services (Caddy
  moved out, see above):
  - `node-app` — the Fastify backend. Bind-mounts `/etc/pwm-app-cert` read-only, and
    reads `CA_CLIENT_CERT_PATH`/`CA_CLIENT_KEY_PATH`/`CA_TRUST_CERT_PATH` pointing into
    it — these are the files from the CA bootstrap runbook's step 2 (pwm-app's own
    CA-signed client cert, for authenticating to pwm-ca's `/sign`/`/revoke`/`/crl`), not
    the end-user mTLS certs (those are per-device, issued at runtime via
    `/cert/initial`/`/cert/renew`/`/cert/initial-for-existing-user`, never baked into the
    container). Binds port 3000 to the host (`ports:`, not `expose:`) so pwm-proxy can
    reach it over the LAN — firewalled to accept only from pwm-proxy's IP
    (`docs/PROXMOX_NETWORK.md`), this is the real new attack-surface point of the
    migration, not opened to the whole LAN.
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

## Operations (backup, log rotation)

Per `BACKUP.md` / `MONITORING.md`. Done once, as part of this deployment (see `TASKS.md` Phase 6 for the exact state):

### Backups
1. age identity generated **offline**, on the user's own machine — the private key never touched pwm-app or pwm-ca, only the public key (`age1...`) was deployed as `AGE_RECIPIENT`.
2. `infra/backup-db.sh` installed on pwm-app (CT 201), cron daily 3am. `infra/backup-ca.sh` installed on pwm-ca (CT 202), cron weekly Sun 4am.
3. Backup target: `/backups` is a separate partition on the Proxmox host (already used for `vzdump`), bind-mounted into each container at `/backups/pwm/db` (CT 201) / `/backups/pwm/ca` (CT 202) via `pct set <vmid> -mpX ...` on the Proxmox host — not something either script mounts itself. Ownership needed correcting for each container's unprivileged UID mapping (host UID 100000 = container root UID 0).
4. Both scripts' `BACKUP_DIR` defaults match the above (`/backups/pwm/db`, `/backups/pwm/ca`) — override via the `BACKUP_DIR` env var if deployed differently elsewhere.
5. Restore: `infra/restore-db.sh <dump-file>`, needs the offline age private key passed via `AGE_KEY_FILE`. **The actual restore drill (decrypt + real `psql` restore against a test target) is still outstanding** — per `BACKUP.md`'s explicit "don't skip this" — deliberately deferred, not forgotten (see `TASKS.md`).

### Uptime check
**Explicitly skipped for v1** — user's call, not doing external uptime monitoring at this scale right now. `MONITORING.md`'s guidance (point a free external monitor at `/health` over the public mTLS listener, expect a TLS handshake failure rather than 200 as the "server up" signal since there's no client cert to present) stays documented there if revisited later.

### Log rotation
- `infra/pwm-logrotate.conf` installed at `/etc/logrotate.d/pwm` on **pwm-proxy** (post-migration — Caddy's logs live there now, not pwm-app).
- `infra/caddy/Caddyfile`'s two `log` blocks write to `/var/log/caddy/*.log` inside the Caddy container — `infra/caddy/docker-compose.yml` bind-mounts that path to the host (`/var/log/caddy`) so logrotate can actually reach the files and they survive a container recreate.

## Releasing an app update (in-app update mechanism, Phase 7)

Each self-hoster's own backend serves update checks and the APK itself — see
`TASKS.md` Phase 7 for the full design reasoning (not GitHub Releases, not a
separate updater app).

1. Build and sign a new release APK, same as the very first install — see
   `docs/INSTALL.md` "Build and install" (your existing release keystore,
   same signing key every time: an Android app update requires the exact
   same signing key as the version it's replacing, or the OS refuses it).
2. On pwm-app, set `APP_RELEASES_DIR` (defaults to `/etc/pwm-app-releases`
   if unset) in the `node-app` container's environment — this is where
   `GET /app/version`/`GET /app/apk` read from.
3. **Prerequisite**: `scripts/deploy-apk.sh` needs direct SSH reachability
   from wherever you run it to the pwm-app host/container on port 22 (a
   plain `scp`). This is true for many simple deployments, but not this
   project's own reference Proxmox setup — `docs/PROXMOX_NETWORK.md`'s
   firewall rules deliberately restrict pwm-app's SSH to the Proxmox host
   itself, not arbitrary LAN machines (see `docs/DECISIONS.md` for the
   full reasoning). If your topology is similarly locked down, either run
   the script from a machine that does have SSH access (e.g. the Proxmox
   host itself), or skip the script and do the equivalent two steps
   manually with whatever access method you do have (`pct push`, a
   different remote-copy tool, etc.) — copy the APK to
   `${APP_RELEASES_DIR}/app-release.apk` and write
   `${APP_RELEASES_DIR}/version.json` as `{"versionCode": N,
   "versionName": "..."}`, both atomically (temp file + rename), on the
   pwm-app host.
4. Copy `scripts/.env.example` to `scripts/.env`, fill in `DEPLOY_SSH_HOST`
   (your SSH target for pwm-app) and `DEPLOY_REMOTE_DIR` (must match
   `APP_RELEASES_DIR` above). Gitignored, never committed.
5. Run:
   ```bash
   ./scripts/deploy-apk.sh \
     packages/mobile/android/app/build/outputs/apk/release/app-release.apk \
     <versionCode> <versionName>
   ```
   `versionCode` must be a plain integer, strictly greater than the
   previous release's — this is what clients compare against their own
   installed version (Android exposes `versionCode`, bumped in
   `android/app/build.gradle`'s `defaultConfig`, to the app natively).
5. Already-installed clients pick up the update on their next
   launch/foreground check (or a manual login) — a dismissible banner
   appears, "Update now" downloads and triggers Android's own install
   confirmation. No server restart needed; the routes read the files
   fresh on every request.

Since package name + signing key stay constant, this is a normal in-place
Android app update, not a fresh install — local data (the device's mTLS
client certificate, cached session, vault cache) persists automatically.
No self-hoster's users need to re-register or re-pair a device after an
update.
