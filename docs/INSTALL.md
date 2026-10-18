# PWM — Installation Guide

A self-hoster's walkthrough for standing up your own PWM instance: two small
Linux hosts (an app server and a CA signing service), a Postgres database, and
one Android device to start. This follows the exact shape validated on the
author's own Proxmox infrastructure — if you're using a different hypervisor
or bare metal, adapt the "create a host" steps and keep everything else.

Read [`PROXMOX_NETWORK.md`](./PROXMOX_NETWORK.md), [`DEPLOY.md`](./DEPLOY.md),
and [`CA_SERVICE_SPEC.md`](./CA_SERVICE_SPEC.md) alongside this if you want the
full reasoning behind each step — this document is the condensed, do-this-now
version.

## 0. What you're building

Two hosts, one internal CA:

| Host | Role | Suggested static IP |
|---|---|---|
| **pwm-app** | Node backend + Postgres + Caddy (TLS termination), all in Docker | `192.168.1.10` |
| **pwm-ca** | Standalone CA signing service — issues/renews/revokes device certs | `192.168.1.11` |

pwm-app has **two separate listeners**: a public one (port 443, full mutual TLS)
reachable from the internet via your router's port-forward, and a LAN-only one
(port 8443, no client cert required) used only during first-device setup — a
brand-new device has no certificate yet, so it can't use the mTLS listener
until it gets one. See `docs/DECISIONS.md` #22 for why this two-listener split
exists.

## 1. Create the two hosts

On Proxmox: create two LXC containers (or VMs — either works; LXC with Docker
nesting enabled is what was actually used and tested).

```
pct create 201 <template> --hostname pwm-app --net0 name=eth0,bridge=vmbr0,ip=192.168.1.10/24,gw=192.168.1.1 \
  --features nesting=1,keyctl=1 --unprivileged 1 --cores 2 --memory 2048

pct create 202 <template> --hostname pwm-ca --net0 name=eth0,bridge=vmbr0,ip=192.168.1.11/24,gw=192.168.1.1 \
  --unprivileged 1 --cores 1 --memory 512
```

pwm-ca is deliberately tiny — it only signs/revokes certs and serves a CRL, no
real load.

On pwm-app, install Docker + Docker Compose. On pwm-ca, install Node.js 22+
(for `services/ca`) and `openssl`.

## 2. Firewall rules

Per `PROXMOX_NETWORK.md`'s allow-lists — write `/etc/pve/firewall/201.fw` and
`/etc/pve/firewall/202.fw` on the Proxmox host:

- **pwm-app**: inbound 443 from anywhere (public mTLS listener), inbound 8443
  from your LAN/VPN range only — **never port-forwarded on the router**,
  outbound to pwm-ca's signing-service port only.
- **pwm-ca**: inbound only from pwm-app's IP, on the signing-service port.
  Nothing else, no exceptions, never reachable from the internet.

Enable per-CT firewalls (`firewall=1` on each `net0`) and the datacenter-wide
master switch (`/etc/pve/firewall/cluster.fw`'s `enable: 1`) — **the master
switch alone can lock you out of the Proxmox web UI/host SSH if no
`host.fw` grants an explicit allow for those**; research this for your own
setup before flipping it, or create a `host.fw` first.

Add one router port-forward: `TCP 443 → 192.168.1.10:443`. Do **not** forward
8443.

## 3. Bootstrap the CA

On **pwm-ca**, clone this repo (or just copy `services/ca/`), then:

```bash
cd services/ca
npm install
npm run build
./scripts/bootstrap.sh
```

This generates, in order:
1. The CA root keypair (`ca.key`/`ca.crt`) — **ECDSA P-256**, not Ed25519 (see
   `docs/DECISIONS.md` #29 — a real Android device's TLS stack doesn't support
   Ed25519 in TLS 1.3's `CertificateVerify`, discovered the hard way during
   the author's own real-device testing; use P-256).
2. pwm-ca's own server cert, for its HTTPS/mTLS listener.
3. Printed instructions for generating pwm-app's client cert (the
   chicken-and-egg cert pwm-app uses to authenticate to pwm-ca) — run the CSR
   generation step on pwm-app, transfer only the CSR back to pwm-ca, sign it
   there, transfer the signed cert back to pwm-app. **Never transfer `ca.key`
   anywhere.**
4. Printed instructions for a second cert — pwm-app's **bootstrap-listener**
   server cert (for the LAN-only :8443 Caddy listener). The mobile app pins
   against the CA root for this connection instead of relying on system TLS
   trust, since that listener can never get a publicly-trusted (Let's
   Encrypt) certificate — see `docs/DECISIONS.md` #28.

Install `services/ca` as a systemd service — see `services/ca/deploy/pwm-ca.service`.

Set up `services/ca/scripts/bootstrap.sh`'s ownership fix if running it after
the systemd unit already exists (the service runs as a restricted `pwm-ca`
user, not root).

## 4. Configure and deploy pwm-app

On **pwm-app**, clone this repo. Copy `.env.example` → `.env` and fill in real
values:

```
PWM_PUBLIC_HOST=<your-real-ddns-hostname>
PWM_IMAGE_TAG=latest
POSTGRES_PASSWORD=<openssl rand -base64 32>
DATABASE_URL=postgresql://pwm:<same-password>@postgres:5432/pwm?schema=public
ENUMERATION_HMAC_SECRET=<openssl rand -base64 32>
CA_SERVICE_URL=https://192.168.1.11:<pwm-ca's port, check services/ca/src/config.ts>
```

Generate secrets directly on pwm-app, never paste them anywhere else:
```bash
openssl rand -base64 32   # run twice, once each for POSTGRES_PASSWORD and ENUMERATION_HMAC_SECRET
```

Place the cert material from step 3 at `/etc/pwm-app-cert/` on pwm-app:
`ca.crt`, `pwm-app-client.crt`, `pwm-app-client.key`, `bootstrap-server.crt`,
`bootstrap-server.key`. `docker-compose.yml` bind-mounts this directory into
both the `caddy` and `node-app` containers.

Then:
```bash
docker compose build   # first deploy only, or after a Dockerfile change
docker compose up -d
docker compose logs -f
```

Watch the logs for a clean startup — no `crl_poll_failed`, no cert/TLS
errors, Caddy serving both listeners. `prisma migrate deploy` runs
automatically on every container start, so the database schema is applied
without a separate step.

**Verify it's actually working, not just "built successfully"** — this
project's own history (`docs/DECISIONS.md` #25-32) found 8 real bugs that
only surfaced once the stack was genuinely running and exercised end to end,
none of them caught by `docker compose build` succeeding or the automated
test suite passing. A clean build is not proof of a working deploy.

## 5. Build and install the Android app

On a machine with the Android SDK + a JDK (17, specifically — newer JDKs have
known incompatibilities with this project's Gradle version):

```bash
cd packages/mobile
cp .env.example .env
# edit .env:
#   SERVER_URL=https://<your-ddns-hostname>       (the public :443 listener)
#   BOOTSTRAP_URL=https://192.168.1.10:8443        (pwm-app's LAN IP, NOT pwm-ca's)
```

**Double-check `BOOTSTRAP_URL` points at pwm-app's IP, not pwm-ca's** — these
are easy to mix up and the resulting failure (a confusing instant TLS
handshake error) doesn't look like a config typo at first glance.

Bundle the CA root as a native asset so the app can pin against it for the
bootstrap listener:
```bash
cp /path/to/ca.crt packages/mobile/android/app/src/main/assets/pwm-ca-root.pem
```

### Release signing (do this once, keep it forever)

```bash
cd packages/mobile/android
keytool -genkeypair -v -keystore app/release.keystore -alias pwm-release \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$(openssl rand -base64 24)" \
  -dname "CN=<your name/org>"
```

Write the resulting store/key passwords into `keystore.properties` (same
directory as `app/build.gradle`'s parent, `android/`):
```
storeFile=release.keystore
storePassword=<the password>
keyAlias=pwm-release
keyPassword=<same password>
```

Both `app/release.keystore` and `keystore.properties` are gitignored — **back
them up somewhere outside the repo.** Losing this keystore means you can
never sign an update to the same app installation again; every user would
need to uninstall and reinstall under a fresh identity.

### Build and install

```bash
cd packages/mobile/android
JAVA_HOME=/path/to/jdk17 ./gradlew clean :app:assembleRelease
adb install app/build/outputs/apk/release/app-release.apk
```

A release build has no Metro/dev-server dependency — the JS bundle is baked
in. Verify it's signed with your real key, not falling back to the debug
keystore:
```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```
The printed `Signer #1 certificate DN` should match the `-dname` you gave
`keytool`, not `C=US, O=Android, CN=Android Debug`.

## 6. First registration

Install the APK, open the app, and register the very first account — it
automatically becomes the admin (race-safe against two simultaneous first
registrations, see `docs/DECISIONS.md` #22). Registration and the first
device certificate are issued over the LAN-only listener, so your phone must
be on the same network as pwm-app (or VPN'd in) for this one step. After
that, the app only ever uses the public mTLS listener — no LAN/VPN
requirement for anything else, including future logins from mobile data.

## 7. Backups, monitoring, and what's still manual

Set up automated backups and log rotation — scripts and setup steps are in
`infra/backup-db.sh`, `infra/backup-ca.sh`, `infra/restore-db.sh`,
`infra/pwm-logrotate.conf`, documented in [`DEPLOY.md`](./DEPLOY.md)'s
"Operations" section.

**Actually run a restore drill** once you have a real backup — an untested
backup is not a backup, per [`BACKUP.md`](./BACKUP.md)'s explicit guidance.
Don't skip this.

Updating the app (new features, bug fixes) currently means rebuilding and
reinstalling the APK manually — there's no in-app update check yet (deferred
to v1.1, see `TASKS.md` Phase 7). Since the app updates in place (same
package name, same signing key), a reinstall over an existing install
preserves all local data (cached session, device certificate) — no
re-registration needed, just `adb install` the new APK over the old one.

## Troubleshooting

- **"Network request failed" during setup, instantly**: almost always a TLS
  handshake problem, not a routing problem. Check `BOOTSTRAP_URL` points at
  the right host (pwm-app, not pwm-ca) and that the bundled
  `pwm-ca-root.pem` asset actually matches the CA that signed pwm-app's
  bootstrap-listener cert.
- **Login works right after setup, fails after logging out and back in**:
  check `docs/DECISIONS.md` #31 and #32 — two real, now-fixed bugs (a
  session-token wiring bug, and a missing JS-engine global) that looked
  exactly like this.
- **Any TLS handshake failure that "shouldn't happen"**: capture the actual
  packet exchange (`tcpdump`/Wireshark) before guessing further — multiple
  real issues in this project's history (`docs/DECISIONS.md` #28-30) looked
  like different bugs until a packet capture showed the real cause.
