#!/usr/bin/env bash
# Red cases for phi-gate.sh: an ID hidden in UTF-16 must fail, an undecodable file must be refused, clean UTF-8 must pass.
set -u
GATE="$(cd "$(dirname "$0")" && pwd)/phi-gate.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cd "$T"; mkdir -p skills
run() { PHI_ROOTS="skills" bash "$GATE" >/dev/null 2>&1; }

echo "clean text" > skills/ok.md
run || { echo "FAIL: clean UTF-8 should pass"; exit 1; }

printf '%s' 'id 123456789 here' | iconv -f UTF-8 -t UTF-16 > skills/u16.md
run && { echo "FAIL: 9-digit ID in UTF-16 passed the gate"; exit 1; }
rm skills/u16.md

printf '\xff\xfe\x00\x00\x01\x02\x03' > skills/junk.bin
run && { echo "FAIL: undecodable file was skipped"; exit 1; }
rm skills/junk.bin

run || { echo "FAIL: clean tree should pass again"; exit 1; }
echo "phi-gate tests OK"
