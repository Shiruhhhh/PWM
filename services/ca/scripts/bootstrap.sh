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

if [[ -f "${DATA_DIR}/ca.key" ]]; then
  echo "Refusing to run: ${DATA_DIR}/ca.key already exists. Delete it first if you really mean to regenerate the CA (this invalidates every issued cert)." >&2
  exit 1
fi

mkdir -p "${DATA_DIR}"
chmod 700 "${DATA_DIR}"

echo "== Step 1/3: generating CA keypair on this host =="
openssl req -x509 -newkey ed25519 -days 3650 -noenc \
  -keyout "${DATA_DIR}/ca.key" \
  -out "${DATA_DIR}/ca.crt" \
  -subj "/CN=PWM Root CA"
chmod 600 "${DATA_DIR}/ca.key"
chmod 644 "${DATA_DIR}/ca.crt"

touch "${DATA_DIR}/crl.json"
echo "[]" > "${DATA_DIR}/crl.json"
touch "${DATA_DIR}/issuance.log"
chmod 600 "${DATA_DIR}/crl.json" "${DATA_DIR}/issuance.log"

echo
echo "CA keypair generated at ${DATA_DIR}/ca.key / ca.crt."
echo
echo "== Step 2/3: generate pwm-ca's own server cert (for its HTTPS/mTLS listener) =="
openssl req -new -newkey ed25519 -noenc \
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
echo "Server cert generated at ${DATA_DIR}/server.key / server.crt (SAN: IP:${SERVER_IP})."
echo
echo "== Step 3/3: generate pwm-app's own client cert, signed by this CA =="
echo "This is the chicken-and-egg cert that lets pwm-app authenticate to pwm-ca."
echo "Run ON PWM-APP (or anywhere), transfer only the resulting CSR here, then run:"
echo
echo "  # on pwm-app:"
echo "  openssl req -new -newkey ed25519 -noenc \\"
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
