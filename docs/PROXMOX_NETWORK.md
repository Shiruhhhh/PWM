# PWM — Proxmox Network / Firewall Layout

## Current topology (as of inspection, 2026-10-13)

Single flat bridge, no VLAN segmentation, no Proxmox firewall rules configured anywhere yet (`firewall=1` flag set on some configs but no ruleset behind it — currently a no-op).

| ID | Name | Type | IP | Role |
|----|------|------|----|------|
| 101 | OPEN-VPN | LXC | 192.168.1.2 | existing VPN |
| 102 | crafty-controller | LXC | 192.168.1.5 | Minecraft server |
| 100 | StoneBlock4 | VM | DHCP (unset static) | Minecraft-related VM |

Bridge: `vmbr0`, 192.168.1.0/24, gateway 192.168.1.1. Host itself: 192.168.1.254.
Public DDNS `REDACTED-DDNS-HOST.example.com` → `203.0.113.1` (router WAN IP).

**Risk as-is**: everything flat, no isolation. Any CT/VM compromise can freely reach any other CT/VM on the LAN — relevant to earlier discussion about Minecraft-VM-pivot risk. No current segmentation prevents it.

## Planned additions for PWM

| New resource | Type | Suggested IP | Role |
|---|---|---|---|
| pwm-app | VM or LXC | 192.168.1.10 (static) | Node backend + Caddy (mTLS termination) |
| pwm-ca | LXC | 192.168.1.11 (static) | CA signing service (decision #12) |

## Firewall strategy

Proxmox has per-VM/CT firewall (`firewall=1` + rules in `/etc/pve/firewall/<vmid>.fw`) and a cluster-wide one (`/etc/pve/firewall/cluster.fw`, currently empty). Use **per-CT/VM rules**, not datacenter-wide, to avoid affecting existing Minecraft/VPN setup.

### pwm-app (192.168.1.10)

Per `docs/DECISIONS.md` #22, Caddy runs **two separate listeners** on this VM/LXC, both
needing their own firewall treatment:

- **Inbound allowed**: TCP 443 from anywhere (the public, full-mTLS listener — router
  port-forwards here, per earlier decision; unauthenticated TLS handshakes rejected by
  Caddy, not by firewall, so firewall just needs to let the port through).
- **Inbound allowed**: TCP on the LAN-only listener's port (suggest **8443**, picked to
  avoid colliding with 443 on the same host; not itself significant) **only from
  192.168.1.0/24** (this flat LAN — there's no separate VPN subnet; the existing OpenVPN
  CT, 192.168.1.2, bridges remote clients onto this same `192.168.1.0/24` range, so
  "LAN/VPN-only" in practice means "this /24, however the client got onto it"). **Never
  port-forwarded on the router** — this listener must never be reachable from the public
  internet, by design (it's the one that doesn't require mTLS at all).
- **Inbound allowed**: SSH (22) from host/admin IP only, if needed for management — not from internet.
- **Outbound allowed**: to 192.168.1.11 (pwm-ca) on its signing-service port only, for cert renewal forwarding.
- **Outbound allowed**: standard (DNS, NTP, package updates).
- **Explicitly blocked**: inbound from 192.168.1.5 / Minecraft VM to EITHER pwm-app
  listener — no reason it should ever reach the password manager backend, including the
  LAN-only one. (192.168.1.2, the OpenVPN CT, is explicitly *allowed* to the LAN-only
  listener — it's the bridge remote legitimate clients use to reach it.) Deny by default,
  allow only what's listed.

### pwm-ca (192.168.1.11)
- **Inbound allowed**: only from 192.168.1.10 (pwm-app), on the signing-service port. Nothing else, no exceptions.
- **No inbound from internet at all** — never port-forwarded on router, not reachable via DDNS.
- **Outbound**: none needed beyond OS updates — this service makes no outgoing calls as part of its normal function.

### Existing Minecraft (101, 102) / OpenVPN (101)
- No changes required for their own function.
- Recommended addition regardless of PWM: block Minecraft CT/VM (102, 100) from initiating connections to 192.168.1.10/192.168.1.11 — enforces the isolation assumption flagged earlier in the "can a Minecraft hacker pivot" discussion, closes the actual gap found (currently flat, no rules).

## Router port forwarding (confirm existing + add one)

Existing rules (inferred from current services):
```
UDP 1194  → 192.168.1.2:1194      (OpenVPN, CT 101)
TCP 25565 → 192.168.1.5:25565     (Minecraft, CT 102) [confirm actual port in crafty-controller config]
```

New rule to add:
```
TCP 443   → 192.168.1.10:443      (PWM backend, mTLS via Caddy, public listener)
```
No rule needed for 192.168.1.11 (pwm-ca) — stays internal-only, by design.

**No router rule for the LAN-only listener's port (8443)** — it must stay unreachable
from the public internet by design (see `docs/DECISIONS.md` #22); only the Proxmox
firewall's `192.168.1.0/24`-only allow rule above gates it.

## Action items before implementation

1. Assign static IPs to pwm-app (192.168.1.10) and pwm-ca (192.168.1.11) at creation time — avoid DHCP drift (note: StoneBlock4 VM 100 currently has no static IP set, worth fixing separately but out of scope here).
2. Write actual Proxmox firewall rule files for pwm-app and pwm-ca once created (`/etc/pve/firewall/<vmid>.fw`), using the allow-lists above, default deny.
3. Add the one new router port-forward rule (443 → pwm-app).
4. Optional hardening, not blocking: segment Minecraft/VPN CTs from the two new PWM resources, formalizing current implicit isolation into actual firewall rules now that the gap is confirmed.
