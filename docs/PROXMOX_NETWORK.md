# PWM — Proxmox Network / Firewall Layout

## Current topology

Single flat bridge, `vmbr0`, `192.168.1.0/24`, gateway `192.168.1.1`. Host itself:
`192.168.1.254`. Per-CT Proxmox firewalls enabled (`firewall=1` + rules in
`/etc/pve/firewall/<vmid>.fw`), datacenter-wide master switch enabled
(`/etc/pve/firewall/cluster.fw`'s `enable: 1`).

| ID | Name | Type | IP | Role |
|----|------|------|----|------|
| 100 | StoneBlock4 | VM | DHCP (unset static) | Minecraft-related VM |
| 101 | OPEN-VPN | LXC | 192.168.1.2 | OpenVPN, bridges remote clients onto this LAN |
| 102 | crafty-controller | LXC | 192.168.1.5 | Minecraft server |
| 200 | pwm-proxy | LXC | 192.168.1.12 | Shared Caddy reverse proxy (PWM + other projects) |
| 201 | pwm-app | LXC | 192.168.1.10 | Node backend + Postgres (no TLS of its own) |
| 202 | pwm-ca | LXC | 192.168.1.11 | CA signing service |

**Risk as-is**: no VLAN segmentation, one flat bridge. Any CT/VM compromise can in
principle reach any other CT/VM unless explicitly firewalled off — mitigated per-resource
below, not by network topology.

## Reverse-proxy architecture (CT 200)

As of the reverse-proxy migration (see `docs/DECISIONS.md`), Caddy no longer runs on
pwm-app itself — it runs on a separate shared LXC (`pwm-proxy`, CT 200), since a router
can only forward port 443 to one internal IP and a second, unrelated self-hosted project
needed to share it. PWM moved from the bare DDNS domain to its own subdomain
(`pwm.<your-ddns-host>`) as part of this.

pwm-proxy terminates both of PWM's listeners (public mTLS 443, LAN-only bootstrap 8443)
and reverse-proxies to pwm-app's Node backend over the LAN (`192.168.1.10:3000`) — these
two containers no longer share a Docker network, so this is a real network hop, not
Compose-internal DNS. See `infra/caddy/` for pwm-proxy's own deploy, and the repo-root
`docker-compose.yml` for pwm-app's (now just `node-app` + `postgres`).

## Firewall per resource

### pwm-proxy (192.168.1.12)

- **Inbound allowed**: TCP 443 from anywhere (public, full-mTLS listener — router
  forwards here now, not to pwm-app). Unauthenticated TLS handshakes rejected by Caddy,
  not the firewall.
- **Inbound allowed**: TCP 8443 **only from `192.168.1.0/24`** (LAN-only bootstrap
  listener — no separate VPN subnet; the OpenVPN CT bridges remote clients onto this same
  `/24`). **Never port-forwarded on the router.**
- **Inbound allowed**: SSH (22) from host/admin IP only.
- **Outbound allowed**: to `192.168.1.10` (pwm-app) on port 3000 only, for the
  reverse-proxy target. Standard (DNS, NTP, package updates, Let's Encrypt ACME).

### pwm-app (192.168.1.10)

- **Inbound allowed**: TCP 3000 **only from `192.168.1.12`** (pwm-proxy) — this is the
  real attack-surface change from the migration: port 3000 is now bound to the host
  (`docker-compose.yml`'s `ports:`, was `expose:` only) so pwm-proxy can reach it over the
  LAN, which means it must be just as tightly firewalled as any other inbound rule here,
  not left open to the whole `/24`.
- **Inbound allowed**: SSH (22) from host/admin IP only.
- **Outbound allowed**: to `192.168.1.11` (pwm-ca) on its signing-service port, for cert
  issuance/renewal/revocation forwarding. Standard (DNS, NTP, package updates).
- **Explicitly blocked**: inbound from `192.168.1.5` / Minecraft VM — no reason it should
  ever reach the password manager backend.

### pwm-ca (192.168.1.11)

- **Inbound allowed**: only from `192.168.1.10` (pwm-app), on the signing-service port.
  Nothing else, no exceptions.
- **No inbound from internet at all** — never port-forwarded, not reachable via DDNS.
- **Outbound**: none needed beyond OS updates.

### Existing Minecraft (100, 102) / OpenVPN (101)

- No changes required for their own function.
- Minecraft CT/VM (100, 102) blocked from initiating connections to any PWM resource
  (`192.168.1.10`, `.11`, `.12`) — closes the Minecraft-VM-pivot risk flagged earlier.

## Router port forwarding

```
UDP 1194  → 192.168.1.2:1194       (OpenVPN, CT 101)
TCP 25565 → 192.168.1.5:25565      (Minecraft, CT 102)
TCP 443   → 192.168.1.12:443       (shared reverse proxy, CT 200 -- was 192.168.1.10
                                     before the migration; this rule needed flipping,
                                     a live router change, confirmed with the user)
```

No rule for `192.168.1.11` (pwm-ca) or `192.168.1.10` (pwm-app, post-migration) — both
stay internal-only, by design. **No router rule for port 8443** — the LAN-only bootstrap
listener must stay unreachable from the public internet; only the Proxmox firewall's
`192.168.1.0/24`-only allow rule on pwm-proxy gates it.

## DNS

`pwm.<your-ddns-host>` is a CNAME onto the same DDNS hostname the router's dynamic-DNS
client already updates — no separate dynamic-DNS registration needed, the subdomain just
rides on the existing A/AAAA record's updates.
