#!/usr/bin/env bash
# verify-deploy.sh — Post-deploy live verification.
#
# Curls the live GitHub Pages sw.js for ward-helper and confirms the expected
# version string appears in the deployed asset. Polls with backoff because
# Pages takes ~60-90s to publish after push.
#
# Why: ward-helper's index.html is a thin shell whose only version-bearing
# JS lives in hashed bundle filenames, so it isn't a stable verification
# surface. sw.js however is rewritten at build time by the swVersionSync
# Vite plugin so its VERSION constant always matches package.json. This
# script validates the LIVE sw.js actually shipped the new version — catches
# the "Pages build silently failed" + "old SW still cached at edge" cases.
#
# Usage:
#   ./scripts/verify-deploy.sh                # uses package.json version
#   ./scripts/verify-deploy.sh 1.32.0         # explicit version
#   ./scripts/verify-deploy.sh --wait 180     # max wait seconds (default 120)
#   ./scripts/verify-deploy.sh --no-wait      # one-shot check, no polling
#
# Exit codes:
#   0 — live sw.js shows the expected version
#   1 — version mismatch after wait window
#   2 — usage error or network failure

set -u

LIVE_SW='https://eiasash.github.io/ward-helper/sw.js'
WAIT_MAX=120
INTERVAL=10
ONESHOT=0
VERSION=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait) WAIT_MAX="$2"; shift 2;;
    --no-wait) ONESHOT=1; shift;;
    -h|--help) sed -n '1,30p' "$0"; exit 0;;
    -*) echo "verify-deploy: unknown flag $1" >&2; exit 2;;
    *) VERSION="$1"; shift;;
  esac
done

if [[ -z "$VERSION" ]]; then
  if ! VERSION=$(node -p "require('./package.json').version" 2>/dev/null); then
    echo "verify-deploy: cannot read package.json version" >&2
    exit 2
  fi
fi

echo "verify-deploy: expecting v${VERSION}"
echo "  SW: ${LIVE_SW}"

start=$(date +%s)
while true; do
  sw_ok=0

  sw_body=$(curl -sf -A 'Mozilla/5.0 verify-deploy' --max-time 15 "${LIVE_SW}" || true)

  if printf '%s' "$sw_body" | grep -qE "VERSION[[:space:]]*=[[:space:]]*['\"]ward-v${VERSION}['\"]"; then
    sw_ok=1
  fi

  if [[ "$sw_ok" = 1 ]]; then
    elapsed=$(( $(date +%s) - start ))
    echo "  SW VERSION=ward-v${VERSION}  PASS"
    echo "verify-deploy: PASS (after ${elapsed}s)"
    exit 0
  fi

  elapsed=$(( $(date +%s) - start ))
  if [[ "$ONESHOT" = 1 ]] || (( elapsed >= WAIT_MAX )); then
    echo ""
    echo "verify-deploy: FAIL after ${elapsed}s"
    echo "  x live sw.js missing VERSION='ward-v${VERSION}'"
    echo ""
    echo "Possible causes:"
    echo "  - GitHub Pages still building — wait 30s, retry"
    echo "  - Push didn't land on main"
    echo "  - swVersionSync Vite plugin failed — check build log"
    echo "  - CDN cache — try cache-busted URL: ${LIVE_SW}?v=${VERSION}"
    exit 1
  fi

  echo "  ...polling (sw=${sw_ok}, ${elapsed}s/${WAIT_MAX}s) — sleeping ${INTERVAL}s"
  sleep "$INTERVAL"
done
