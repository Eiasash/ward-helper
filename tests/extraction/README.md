# Extraction eval harness

Each fixture is a pair:
- `fixtures/<name>.png` — a synthetic AZMA screenshot (PHI-stripped or fully synthetic)
- `fixtures/<name>.json` — the expected structured extraction

`scripts/record-extraction.mjs` (dev tool) runs the real Anthropic API once
per fixture with the bundled `azma-ui` skill, saves the response into
`recorded/<name>.json`, and commits those.

`eval.test.ts` replays `recorded/<name>.json` against the ground truth in
`fixtures/<name>.json` and asserts critical-field accuracy. No live API
calls happen in CI — only the replay comparison.

**Ship target**: ≥ 20 fixtures, ≥ 95% accuracy on critical fields
(name, teudatZehut, age, meds[].name).

**Status**: scaffold only. Fixtures + recordings to be added as real
AZMA screens are curated (with PHI stripped or fully synthesized).
