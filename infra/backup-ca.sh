#!/usr/bin/env bash
# PWM — weekly CA data backup, per docs/BACKUP.md "3. CA signing LXC data".
#
# Runs ON pwm-ca (CT 202), via cron. Tars + encrypts /etc/pwm-ca/ (ca.key,
# ca.crt, crl.json, issuance.log) -- the single hardest-to-recover piece in
# the whole system. Also covered by the weekly Proxmox vzdump snapshot of
# the whole LXC (belt-and-suspenders, per BACKUP.md).
#
# Setup: same age key as infra/backup-db.sh (one shared offline key for
# all PWM backups is fine -- it's the SAME trust boundary either way).
# Same separate-partition bind-mount note as backup-db.sh applies here too
# (/backups bind-mounted into this container via `pct set` on the Proxmox
# host, with UID-mapping-aware ownership for this unprivileged container).
#   crontab -e:
#     0 4 * * 0 /opt/pwm-ca-backup/backup-ca.sh >> /var/log/pwm-ca-backup.log 2>&1
#
# To restore: decrypt + untar back into /etc/pwm-ca/, or restore the
# weekly vzdump snapshot of the whole LXC via Proxmox.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/pwm/ca}"
DATA_DIR="${DATA_DIR:-/etc/pwm-ca}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FIRST_BACKUP_MARKER="${BACKUP_DIR}/.first-backup-done"

if [[ -z "${AGE_RECIPIENT}" ]]; then
  echo "AGE_RECIPIENT not set -- see this script's setup comment. Refusing to run unencrypted." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}/weekly"

TAR_FILE="${BACKUP_DIR}/weekly/pwm-ca-${TIMESTAMP}.tar.age"
tar -czf - -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")" \
  | age -r "${AGE_RECIPIENT}" -o "${TAR_FILE}"

echo "Backed up to ${TAR_FILE}"

# Indefinite copy of the very first post-bootstrap backup (BACKUP.md:
# "extra safety net for the one irreplaceable artifact in the whole
# system") -- never rotated away, kept separately from the weekly tier.
if [[ ! -f "${FIRST_BACKUP_MARKER}" ]]; then
  cp "${TAR_FILE}" "${BACKUP_DIR}/pwm-ca-FIRST-BACKUP-${TIMESTAMP}.tar.age"
  touch "${FIRST_BACKUP_MARKER}"
  echo "First-ever backup preserved indefinitely at ${BACKUP_DIR}/pwm-ca-FIRST-BACKUP-${TIMESTAMP}.tar.age"
fi

# Rotation: keep last 4 weekly (the indefinite first-backup copy above is
# a separate file, untouched by this).
find "${BACKUP_DIR}/weekly" -name 'pwm-ca-*.tar.age' -printf '%T@ %p\n' \
  | sort -rn | tail -n +5 | cut -d' ' -f2- | xargs -r rm -f

echo "Rotation complete. Weekly: $(find "${BACKUP_DIR}/weekly" -name 'pwm-ca-*.tar.age' | wc -l)"
