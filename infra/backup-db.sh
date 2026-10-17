#!/usr/bin/env bash
# PWM — daily DB backup, per docs/BACKUP.md "1. DB dump (pwm-app)".
#
# Runs ON pwm-app (CT 201), via cron. Dumps the Postgres DB, encrypts the
# dump with age (passphrase-based, key held offline per BACKUP.md's
# "Encryption of backups themselves" -- never on this host), writes it to
# the backup drive, and rotates old backups (14 daily + 6 monthly).
#
# Setup (one-time, manual):
#   1. Generate an age identity offline, keep ONLY the public key here:
#        age-keygen -o pwm-backup-key.txt   # do this OFFLINE, not on pwm-app
#      Copy the "public key: age1..." line into AGE_RECIPIENT below.
#      Store pwm-backup-key.txt (the private key) somewhere offline --
#      NOT on pwm-app, NOT on the backup drive itself (BACKUP.md).
#   2. Install age: apt-get install -y age
#   3. The backup drive is a separate partition on the Proxmox host
#      (already used for vzdump), bind-mounted into this container at
#      /backups via `pct set <vmid> -mpX /backups,mp=/backups` on the
#      Proxmox host -- not a mount this container does itself. Ownership
#      needs correcting for unprivileged-container UID mapping (host UID
#      100000 = container root UID 0) after the mount is added.
#   4. Add to pwm-app's crontab (crontab -e):
#        0 3 * * * /opt/pwm/infra/backup-db.sh >> /var/log/pwm-backup.log 2>&1
#
# To restore: see infra/restore-db.sh.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/pwm/db}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/pwm}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"  # age1... public key, set via env or edit here
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -z "${AGE_RECIPIENT}" ]]; then
  echo "AGE_RECIPIENT not set -- see this script's setup comment. Refusing to run unencrypted." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/monthly"

cd "${COMPOSE_DIR}"
DUMP_FILE="${BACKUP_DIR}/daily/pwm-db-${TIMESTAMP}.sql.age"

# Scope per BACKUP.md: users, vault_blobs, client_certs. Sessions excluded
# deliberately (cheap to exclude, just forces re-login after a restore).
docker compose exec -T postgres pg_dump -U pwm -d pwm \
  --table=users --table=vault_blobs --table=client_certs \
  | age -r "${AGE_RECIPIENT}" -o "${DUMP_FILE}"

echo "Backed up to ${DUMP_FILE}"

# Monthly copy: first successful daily run of the month gets mirrored into
# monthly/, so the monthly retention tier doesn't need its own cron entry.
if [[ "$(date -u +%d)" == "01" ]]; then
  cp "${DUMP_FILE}" "${BACKUP_DIR}/monthly/pwm-db-${TIMESTAMP}.sql.age"
fi

# Rotation: keep last 14 daily, last 6 monthly.
find "${BACKUP_DIR}/daily" -name 'pwm-db-*.sql.age' -printf '%T@ %p\n' \
  | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f
find "${BACKUP_DIR}/monthly" -name 'pwm-db-*.sql.age' -printf '%T@ %p\n' \
  | sort -rn | tail -n +7 | cut -d' ' -f2- | xargs -r rm -f

echo "Rotation complete. Daily: $(find "${BACKUP_DIR}/daily" -name 'pwm-db-*.sql.age' | wc -l), Monthly: $(find "${BACKUP_DIR}/monthly" -name 'pwm-db-*.sql.age' | wc -l)"
