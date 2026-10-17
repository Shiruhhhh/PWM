#!/usr/bin/env bash
# PWM — restore a DB backup produced by infra/backup-db.sh.
# Per docs/BACKUP.md "Restore procedure", case 1 (data-only loss).
#
# Usage: ./restore-db.sh <path-to-.sql.age-file>
#
# Requires the age PRIVATE key (pwm-backup-key.txt, held offline per
# BACKUP.md) to be available locally when running this -- never store it
# on pwm-app itself.
set -euo pipefail

DUMP_FILE="${1:?Usage: ./restore-db.sh <path-to-.sql.age-file>}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/pwm}"
AGE_KEY_FILE="${AGE_KEY_FILE:?Set AGE_KEY_FILE to the offline age private key file}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "File not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "This will restore ${DUMP_FILE} into the running pwm-app Postgres DB."
echo "Existing rows in users/vault_blobs/client_certs will be overwritten where they conflict."
read -r -p "Continue? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

cd "${COMPOSE_DIR}"
age -d -i "${AGE_KEY_FILE}" "${DUMP_FILE}" | docker compose exec -T postgres psql -U pwm -d pwm

echo "Restore complete. Sessions table was NOT part of the backup -- all devices will need to log in again."
