# PWM — CA Signing Service Spec (pwm-ca LXC)

Internal-only service. Never reachable from internet, never port-forwarded. Reachable only from pwm-app (192.168.1.10) per firewall rules in PROXMOX_NETWORK.md.

## Responsibilities

- Hold CA private key (generated once at bootstrap, never leaves this LXC in plaintext).
- Sign CSRs for client device certs (user phones) and the one app-VM-to-CA-service cert.
- Maintain CRL (certificate revocation list).
- No other function. No DB, no business logic, no user data.

## Storage (flat files, no DB needed)

- `/etc/pwm-ca/ca.key` — CA private key, file permissions `600`, root-only.
- `/etc/pwm-ca/ca.crt` — CA public cert.
- `/etc/pwm-ca/crl.json` — revoked fingerprints list, `{ fingerprint, revokedAt }[]`.
- `/etc/pwm-ca/issuance.log` — append-only, `{ cn, fingerprint, issuedAt, expiresAt }` per line (JSONL), never truncated/edited, audit trail only.

## Endpoints (internal mTLS — pwm-app itself holds a cert to talk to this service, bootstrapped manually once)

### `POST /sign`
Body: `{ csr, requestingUserId, deviceCn }`
- Validates CSR format/key strength (reject weak keys, e.g. RSA < 2048 or non-approved curve).
- Signs with CA key. Expiry: 90 days (short, since renewal now automatic per decision #9 — shorter window reduces damage if a cert ever leaks).
- Appends to `issuance.log`.
- Returns: `{ cert, fingerprint, expiresAt }`

### `POST /revoke`
Body: `{ fingerprint }`
- Adds `{ fingerprint, revokedAt }` to `crl.json`.
- Returns: `{ crlVersion }` (simple incrementing counter or hash of CRL contents, lets pwm-app detect staleness).

### `GET /crl`
- Returns current `crl.json` contents.
- pwm-app polls this periodically (e.g. every 15 min) to refresh its own revoked-cert rejection list.

**Correction found during Phase 2 implementation (see `docs/DECISIONS.md` #17):** stock
Caddy has no built-in CRL/revocation directive in `client_auth` — it only verifies a
cert chains to a trusted CA, not whether that cert was later revoked. Revocation
checking happens at the **application layer** instead: pwm-app fetches and caches this
CRL, and a Fastify preHandler on every session-required route checks the presented
client cert's fingerprint against it, rejecting with 401 if revoked. Caddy's
`client_auth` config stays `require_and_verify` (trusted-CA check only) — see
`infra/Caddyfile`.

### `GET /health`
- Trivial liveness check, no auth needed beyond network-level isolation (nothing sensitive returned — just `{ status: "ok" }`).

## Bootstrap (one-time, manual, not automated)

1. Generate CA keypair on this LXC directly (never generate elsewhere and transfer — private key should be born here).
2. Generate pwm-app's own client cert, signed by this CA, manually — this is the chicken-and-egg cert that lets pwm-app authenticate to this service in the first place. Transfer only the signed cert (not CA key) to pwm-app.
3. From this point on, all *user device* certs renew automatically through `/sign`; the CA key itself and the app-to-CA trust relationship stay manually managed, touched rarely.

## Operational notes

- Runs as a plain Node/Fastify process (or small Go binary) under systemd, no Docker needed here — service is tiny, low-churn, simpler to keep bare.
- Logs via journald, reviewed per MONITORING.md.
- CA key backup handled in BACKUP.md — losing it without backup permanently breaks the ability to issue/revoke any future cert (existing certs keep working until they expire, but no renewal possible).
