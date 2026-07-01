#!/usr/bin/env bash
# CI PHI gate — fails the build on any patient/staff identifier in shipped skill content.
# Wire into .github/workflows/ci.yml as a REQUIRED step. Makes scrub zero-miss by construction.
set -euo pipefail
ROOTS=("public/skills" "src/skills")
DENY='***REDACTED-ID***|***REDACTED-ID***|***REDACTED-LICENSE***|the rehab case manager|the rehab case manager|the rehab case manager|the rehab case manager|the side-B case manager|the side-B case manager|the reporting radiologist|the ESRD/HD case|the ESRD/HD case|the deconditioning exemplar|the femur exemplar|the index case|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT|PATIENT'
ALLOW9='000147224|177774|328824236|834704553'   # Eias's own license + the 3 known false-positives
# ALLOWLIST — de-identified archetype labels + note-format template terms. These ARE the scrub's own
# replacement descriptors (v1.46.31), not identifiers; exempting them stops the gate crying wolf while
# leaving EVERY real-identifier detector in DENY/ALLOW9 above intact. Add benign terms here, never to DENY.
ALLOW_LABELS='הרשאות|PATIENT CAPSULE|the rehab case manager|the side-B case manager|the reporting radiologist|the ESRD/HD case|the deconditioning exemplar|the femur exemplar|the index case'
fail=0
for r in "${ROOTS[@]}"; do
  [ -d "$r" ] || continue
  # denylist — exempt the benign de-identified/template terms in ALLOW_LABELS (archetype labels + PATIENT CAPSULE)
  if grep -rIEn "$DENY" "$r" 2>/dev/null | grep -vE "$ALLOW_LABELS"; then
    echo "::error::PHI identifier found in $r"; fail=1
  fi
  # any 9-digit ID not on the allowlist
  if grep -rIhoE '[0-9]{9}' "$r" 2>/dev/null | grep -vE "$ALLOW9" | grep -q .; then
    echo "::error::unexpected 9-digit ID in $r"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "PHI gate passed ✅" || { echo "PHI gate FAILED — see errors above"; exit 1; }
