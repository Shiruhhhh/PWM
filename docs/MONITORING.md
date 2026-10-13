# PWM — Monitoring & Logging Spec

Scope: basic uptime check + log review (decision #11), appropriate for 2-user personal infra — not building a full observability stack.

## What gets logged

### pwm-app
- Structured JSON logs via `pino` (bundled with Fastify).
- Log every: login attempt (success/fail, username — never password/authHash), session creation/expiry, vault read/write (user_id, revision, not contents), cert renewal/revocation events, rate-limit triggers.
- Never log: master password, authHash, vaultKey, recovery key, decrypted vault contents, raw cert private keys.

### pwm-ca
- `issuance.log` (append-only, per CA_SERVICE_SPEC.md) doubles as the primary audit trail.
- journald for service-level events (start/stop/errors).

### Caddy (on pwm-app)
- Access log: shows TLS handshake failures (no client cert / invalid cert) — this is the main signal for "someone's probing the exposed port." Caddy itself does not check revocation (see CA_SERVICE_SPEC.md correction) — a revoked-but-still-trusted-CA-signed cert passes the TLS handshake and is rejected one layer up, by the app.

## What counts as alert-worthy

- Repeated failed mTLS handshakes from same source IP in short window — scanner/attacker probing port 443, expected occasionally, concerning if sustained/escalating.
- Repeated failed `/login` attempts — brute force attempt against a specific username (rate-limit should already throttle this, but still worth seeing in logs).
- Any request reaching a session-required route with a cert whose fingerprint is marked `revoked=true` in the DB or in the cached CRL (would indicate the app-layer revocation check isn't being applied — should be impossible, treat as critical bug if seen).
- pwm-ca `/sign` endpoint called with a `requestingUserId` that doesn't match an active session on pwm-app — would indicate pwm-app's own auth logic broke or was bypassed.
- Backup job failure (dump/snapshot didn't complete) — silent backup failure is the classic way disaster recovery plans fail when actually needed.

## How review happens (manual, appropriate at this scale)

- No dedicated dashboard/Grafana needed for 2 users — that's overkill, more infra to maintain than value gained.
- Lightweight uptime check: a simple external ping (e.g. a free uptime-monitor service, or just Proxmox's own alert-on-VM-down) hitting `GET /health`-equivalent on pwm-app, notifies you (email/push) if backend goes unreachable.
- Periodic manual log review (e.g. monthly, or triggered if you notice odd app behavior) — `journalctl` / Caddy access log tail, scan for the alert-worthy patterns above.
- If this ever grows beyond 2 users or becomes something others self-host at scale, revisit with proper metrics/alerting (Prometheus + Grafana, Loki for logs) — explicitly deferred, not needed now.

## Log retention

- Rotate logs (e.g. `logrotate` or pino's own file rotation) — keep ~30 days, matches backup retention roughly, avoids unbounded disk growth on a small VM.
