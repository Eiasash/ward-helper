# Synthetic safety-engine scenarios

Five clinical archetypes — polypharmacy postop, comfort-care suppression, post-MI undertreated, clean negative control, falls cocktail — driven through `runSafetyChecks()` to surface coverage gaps. **This is the regression artifact for the safety engine: every Beers/STOPP/START/ACB change should rerun it and diff against `baseline.txt` before deploy.**

## Run

```bash
npx tsx scripts/test-scenarios.mjs > scripts/scenarios/latest.txt
diff scripts/scenarios/baseline.txt scripts/scenarios/latest.txt
```

`latest.txt` is gitignored. When a diff reflects intentional new behavior (e.g. Sprint 3 adds Z-drug Beers and A5 goes from 0/4 to 4/4 hits), promote it: `cp latest.txt baseline.txt` and commit with the new baseline plus a one-line note in the commit body explaining what changed and why.

## Interpret

Each scenario block prints `PREDICTED:` (clinically expected hits per Beers 2023 / STOPP/START v3) and `ACTUAL:` (engine output). Auto-flags fire on coarse divergence — predicted-but-empty, ACB under-floor, or any hit on the negative control (A4). Auto-flags are necessary, not sufficient: every `ACTUAL:` block still needs a human read, since the auto-flag misses cases where the engine fires the *wrong* rule for the right reason.

A4 is the false-positive guard. Any hit there means a rule got broader than it should be — investigate before promoting a new baseline.
