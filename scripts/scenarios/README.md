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

## Known gaps (v1.20.1 baseline → Sprint 3)

Pinned from the v1.20.1 baseline so future-you doesn't re-derive them:

1. **A5 falls cocktail** — Z-drugs, TCAs, muscle relaxants, alpha-blockers in elderly women: zero Beers/STOPP coverage. Highest clinical risk.
2. **A1 polypharmacy pairs** — donepezil + oxybutynin (textbook AChEI/anticholinergic antagonism), tramadol + SSRI (serotonin syndrome), sulfonylurea in elder. STOPP gaps.
3. **Renal-dosing engine** — entire rule family missing. NSAIDs in CKD, metformin at eGFR <30, gabapentin dose, nitrofurantoin <30. **Apixaban dose reduction is three-criterion (age ≥80, weight ≤60kg, Cr ≥1.5) — not eGFR alone.** Don't shortcut to a single eGFR threshold when porting this rule; it will produce wrong-dose flags.
4. **ACB scale expansion** — tizanidine, tamsulosin, citalopram should all carry weight; A5 ACB underscored at 3 vs predicted 6.
5. **POST-MI-ACEI** — one-rule START add. Trivial; don't bundle with the bigger ports.
6. **Real-anonymized fixture** — promote one real ward case (anonymized) into the scenario set as the trust-building test once the synthetic gaps are closed.
