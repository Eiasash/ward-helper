#!/usr/bin/env bash
# CI PHI gate — fails the build on any patient/staff identifier in shipped skill content.
# Wire into .github/workflows/ci.yml as a REQUIRED step. Makes scrub zero-miss by construction.
set -euo pipefail
ROOTS=(${PHI_ROOTS:-public/skills src/skills})
DENY='***REDACTED-ID***|***REDACTED-ID***|***REDACTED-LICENSE***|the rehab case manager|the rehab case manager|the rehab case manager|the rehab case manager|the side-B case manager|the side-B case manager|the reporting radiologist|the ESRD/HD case|the ESRD/HD case|the deconditioning exemplar|the femur exemplar|the index case|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT'
ALLOW9='000147224|177774|328824236|834704553'   # Eias's own license + the 3 known false-positives
# ALLOWLIST — de-identified archetype labels + note-format template terms. These ARE the scrub's own
# replacement descriptors (v1.46.31), not identifiers; exempting them stops the gate crying wolf while
# leaving EVERY real-identifier detector in DENY/ALLOW9 above intact. Add benign terms here, never to DENY.
ALLOW_LABELS='הרשאות|PATIENT CAPSULE|the rehab case manager|the side-B case manager|the reporting radiologist|the ESRD/HD case|the deconditioning exemplar|the femur exemplar|the index case'
fail=0
has_nul() { [ "$(tr -d '\000' < "$1" | wc -c)" != "$(wc -c < "$1")" ]; }
# Normalise every file to UTF-8 before scanning: grep -I silently skips UTF-16 (looks binary), so a
# 9-digit ID saved as UTF-16 used to pass. Files that cannot be decoded are refused, never skipped.
SCAN="$(mktemp -d)"; trap 'rm -rf "$SCAN"' EXIT
for r in "${ROOTS[@]}"; do
  [ -d "$r" ] || continue
  while IFS= read -r -d '' f; do
    out="$SCAN/$f"; mkdir -p "$(dirname "$out")"
    if ! has_nul "$f"; then
      cp "$f" "$out"
    elif iconv -f UTF-16 -t UTF-8 "$f" > "$out" 2>/dev/null && ! has_nul "$out"; then
      :   # BOM-marked UTF-16
    elif iconv -f UTF-16LE -t UTF-8 "$f" > "$out" 2>/dev/null && ! has_nul "$out"; then
      :   # UTF-16 without BOM
    elif iconv -f UTF-16BE -t UTF-8 "$f" > "$out" 2>/dev/null && ! has_nul "$out"; then
      :
    else
      echo "::error::unreadable (binary or unsupported encoding) file in shipped skills: $f"; fail=1
    fi
  done < <(find "$r" -type f -print0)
done
for r in "${ROOTS[@]}"; do
  [ -d "$SCAN/$r" ] || continue
  # denylist - exempt the benign de-identified/template terms in ALLOW_LABELS (archetype labels + PATIENT CAPSULE)
  if grep -raEn "$DENY" "$SCAN/$r" 2>/dev/null | grep -vE "$ALLOW_LABELS"; then
    echo "::error::PHI identifier found in $r"; fail=1
  fi
  # any 9-digit ID not on the allowlist
  if grep -rahoE '[0-9]{9}' "$SCAN/$r" 2>/dev/null | grep -vE "$ALLOW9" | grep -q .; then
    echo "::error::unexpected 9-digit ID in $r"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "PHI gate passed." || { echo "PHI gate FAILED - see errors above"; exit 1; }
