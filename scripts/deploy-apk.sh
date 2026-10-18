#!/usr/bin/env bash
# PWM — push a built release APK to pwm-app and bump the version the
# backend reports, per TASKS.md Phase 7 (in-app update mechanism).
#
# This is THE release process: build the APK yourself (see docs/INSTALL.md
# "Build and install"), then run this script to publish it. GET
# /app/version and GET /app/apk (packages/server/src/routes/appVersion.ts,
# appApk.ts) just read a static file + version.json from a known
# directory on pwm-app -- no admin-upload API, no multipart handling.
#
# Usage:
#   ./scripts/deploy-apk.sh <path-to-app-release.apk> <versionCode> <versionName>
#
# Example:
#   ./scripts/deploy-apk.sh \
#     packages/mobile/android/app/build/outputs/apk/release/app-release.apk \
#     2 "1.1.0"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE} -- copy scripts/.env.example to scripts/.env and fill it in first." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${ENV_FILE}"

: "${DEPLOY_SSH_HOST:?scripts/.env must set DEPLOY_SSH_HOST}"
: "${DEPLOY_REMOTE_DIR:?scripts/.env must set DEPLOY_REMOTE_DIR}"

APK_PATH="${1:?Usage: ./deploy-apk.sh <path-to-apk> <versionCode> <versionName>}"
VERSION_CODE="${2:?Usage: ./deploy-apk.sh <path-to-apk> <versionCode> <versionName>}"
VERSION_NAME="${3:?Usage: ./deploy-apk.sh <path-to-apk> <versionCode> <versionName>}"

if [[ ! -f "${APK_PATH}" ]]; then
  echo "APK not found: ${APK_PATH}" >&2
  exit 1
fi

if ! [[ "${VERSION_CODE}" =~ ^[0-9]+$ ]]; then
  echo "versionCode must be a plain integer, got: ${VERSION_CODE}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (used to build version.json safely -- VERSION_NAME could otherwise contain characters that break raw JSON interpolation)." >&2
  exit 1
fi

echo "Deploying ${APK_PATH} as versionCode=${VERSION_CODE} versionName=${VERSION_NAME} to ${DEPLOY_SSH_HOST}:${DEPLOY_REMOTE_DIR}"

ssh "${DEPLOY_SSH_HOST}" "mkdir -p ${DEPLOY_REMOTE_DIR}"

# Upload to a temp name first, then atomically rename into place on the
# remote -- a client mid-download of the previous APK (GET /app/apk)
# should never see a half-written file.
scp "${APK_PATH}" "${DEPLOY_SSH_HOST}:${DEPLOY_REMOTE_DIR}/app-release.apk.tmp"
ssh "${DEPLOY_SSH_HOST}" "mv ${DEPLOY_REMOTE_DIR}/app-release.apk.tmp ${DEPLOY_REMOTE_DIR}/app-release.apk"

# Same tmp-then-rename pattern for version.json -- a client reading
# GET /app/version mid-write should never see a half-written/invalid JSON
# file. Built with jq, not raw printf interpolation -- VERSION_NAME is
# user-supplied and a stray quote/backslash in it would otherwise produce
# malformed JSON, silently breaking GET /app/version for every client.
VERSION_JSON=$(jq -n --argjson versionCode "${VERSION_CODE}" --arg versionName "${VERSION_NAME}" \
  '{versionCode: $versionCode, versionName: $versionName}')
ssh "${DEPLOY_SSH_HOST}" "cat > ${DEPLOY_REMOTE_DIR}/version.json.tmp && mv ${DEPLOY_REMOTE_DIR}/version.json.tmp ${DEPLOY_REMOTE_DIR}/version.json" <<< "${VERSION_JSON}"

echo "Done. Clients will see versionCode=${VERSION_CODE} on their next update check."
