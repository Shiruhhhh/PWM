#!/usr/bin/env bash
# PWM CA bootstrap — manual, one-time, per docs/CA_SERVICE_SPEC.md "Bootstrap" section.
#
# Run this directly on pwm-ca (the LXC), never elsewhere — the CA private key
# must be born on this host and must never be transferred off it in plaintext.
#
# Usage: ./bootstrap.sh [data-dir] [server-ip]
#   data-dir defaults to /etc/pwm-ca
#   server-ip defaults to 192.168.1.11 (pwm-ca's static IP per
#   PROXMOX_NETWORK.md) -- goes into the server cert's SAN, since
#   Node/undici's TLS verification checks SAN against the connection
#   hostname, not just CN, and httpCaClient connects to this IP directly.
set -euo pipefail

DATA_DIR="${1:-/etc/pwm-ca}"
SERVER_IP="${2:-192.168.1.11}"

# ECDSA P-256, not Ed25519 -- see docs/DECISIONS.md #29. Packet-capture
# evidence showed a real Android device's TLS stack never offers ed25519 in
# its ClientHello's signature_algorithms list, making an Ed25519 CA
# fundamentally unable to complete a handshake with some real devices.
# P-256 (ecdsa_secp256r1_sha256) is universally supported. Single source of
# truth for every openssl -newkey invocation below, including the two
# printed as instructions for pwm-app to run itself.
KEYGEN_FLAGS="-newkey ec -pkeyopt ec_paramgen_curve:P-256"

if [[ -f "${DATA_DIR}/ca.key" ]]; then
  echo "Refusing to run: ${DATA_DIR}/ca.key already exists. Delete it first if you really mean to regenerate the CA (this invalidates every issued cert)." >&2
  exit 1
fi

mkdir -p "${DATA_DIR}"
chmod 700 "${DATA_DIR}"

echo "== Step 1/3: generating CA keypair on this host =="
# shellcheck disable=SC2086
openssl req -x509 ${KEYGEN_FLAGS} -days 3650 -noenc \
  -keyout "${DATA_DIR}/ca.key" \
  -out "${DATA_DIR}/ca.crt" \
  -subj "/CN=PWM Root CA"
chmod 600 "${DATA_DIR}/ca.key"
chmod 644 "${DATA_DIR}/ca.crt"

touch "${DATA_DIR}/crl.json"
echo "[]" > "${DATA_DIR}/crl.json"
touch "${DATA_DIR}/issuance.log"
chmod 600 "${DATA_DIR}/crl.json" "${DATA_DIR}/issuance.log"

# pwm-ca.service runs as the restricted pwm-ca:pwm-ca systemd user
# (ProtectSystem=strict, see deploy/pwm-ca.service), but this script runs
# interactively as root -- without this, the service crashes on next
# restart with EACCES reading its own key/cert files. Only chown if that
# user actually exists (it won't on a first-time bootstrap before the
# systemd unit is installed; the installer/runbook step for that should
# chown these same files at that point instead).
if id pwm-ca >/dev/null 2>&1; then
  chown pwm-ca:pwm-ca "${DATA_DIR}/ca.key" "${DATA_DIR}/ca.crt" \
    "${DATA_DIR}/crl.json" "${DATA_DIR}/issuance.log"
fi

echo
echo "CA keypair generated at ${DATA_DIR}/ca.key / ca.crt."
echo
echo "== Step 2/3: generate pwm-ca's own server cert (for its HTTPS/mTLS listener) =="
# shellcheck disable=SC2086
openssl req -new ${KEYGEN_FLAGS} -noenc \
  -keyout "${DATA_DIR}/server.key" -out /tmp/pwm-ca-server.csr \
  -subj "/CN=pwm-ca" \
  -addext "subjectAltName=IP:${SERVER_IP}"
openssl x509 -req -in /tmp/pwm-ca-server.csr \
  -CA "${DATA_DIR}/ca.crt" -CAkey "${DATA_DIR}/ca.key" -CAcreateserial \
  -days 3650 -sha256 -copy_extensions copy \
  -out "${DATA_DIR}/server.crt"
rm -f /tmp/pwm-ca-server.csr
chmod 600 "${DATA_DIR}/server.key"
chmod 644 "${DATA_DIR}/server.crt"
if id pwm-ca >/dev/null 2>&1; then
  chown pwm-ca:pwm-ca "${DATA_DIR}/server.key" "${DATA_DIR}/server.crt" "${DATA_DIR}/ca.srl"
fi
echo "Server cert generated at ${DATA_DIR}/server.key / server.crt (SAN: IP:${SERVER_IP})."
echo
echo "== Step 3/3: generate pwm-app's own client cert, signed by this CA =="
echo "This is the chicken-and-egg cert that lets pwm-app authenticate to pwm-ca."
echo "Run ON PWM-APP (or anywhere), transfer only the resulting CSR here, then run:"
echo
echo "  # on pwm-app:"
echo "  openssl req -new ${KEYGEN_FLAGS} -noenc \\"
echo "    -keyout pwm-app-client.key -out pwm-app-client.csr \\"
echo "    -subj '/CN=pwm-app'"
echo "  # transfer pwm-app-client.csr to this host, then here:"
echo "  openssl x509 -req -in pwm-app-client.csr \\"
echo "    -CA ${DATA_DIR}/ca.crt -CAkey ${DATA_DIR}/ca.key -CAcreateserial \\"
echo "    -days 3650 -sha256 -out pwm-app-client.crt"
echo "  # transfer pwm-app-client.crt back to pwm-app (NOT ca.key — never transfer the CA key)."
echo
echo "After this, all user-device certs renew automatically through POST /sign."
echo "The CA key and this one app-to-CA cert stay manually managed from here on."
echo
echo "== Also needed once: pwm-proxy's bootstrap-listener server cert =="
echo "The :8443 LAN-only Caddy listener (docs/DECISIONS.md #28) runs on"
echo "pwm-proxy (docs/DECISIONS.md's reverse-proxy migration entry), not"
echo "pwm-app. Needs its own server cert signed by this CA, so the mobile"
echo "app can pin against it instead of relying on system TLS trust (that"
echo "bare port can't get a Let's Encrypt cert). Same pattern as step 3 above:"
echo
echo "  # on pwm-proxy:"
echo "  openssl req -new ${KEYGEN_FLAGS} -noenc \\"
echo "    -keyout bootstrap-server.key -out bootstrap-server.csr \\"
echo "    -subj '/CN=pwm-proxy-bootstrap' \\"
echo "    -addext 'subjectAltName=IP:192.168.1.12'"
echo "  # transfer bootstrap-server.csr to this host, then here:"
echo "  openssl x509 -req -in bootstrap-server.csr \\"
echo "    -CA ${DATA_DIR}/ca.crt -CAkey ${DATA_DIR}/ca.key -CAcreateserial \\"
echo "    -days 3650 -sha256 -copy_extensions copy -out bootstrap-server.crt"
echo "  # transfer bootstrap-server.crt + bootstrap-server.key back to"
echo "  # pwm-proxy, into /etc/pwm-proxy-cert/ (see infra/caddy/docker-compose.yml)."
echo
echo "The mobile app bundles ${DATA_DIR}/ca.crt itself (as an asset, see"
echo "packages/mobile/android/app/src/main/assets/) to pin against -- copy that"
echo "file out alongside the above."
