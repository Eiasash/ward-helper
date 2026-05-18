# PHI cold-start unlock scenario — mega-bot kickoff spec

**Repo path on land:** `docs/audit/2026-05-18-phi-unlock-scenario-kickoff.md`
**Status:** SPEC ONLY. Authored by web lane 2026-05-18. Not implemented.
**Lane:** terminal reviews + lands *this doc*; scenario implementation + the stochastic run are a **separate, spend-gated kickoff**.

---

## 0. Provenance — why this doc exists

This is the parked **"PHI scenario"** proposal from the mega-bot audit. The audit's D5 closure record (`docs/audit/2026-05-17-mega-bot-D5-run-log.md`, 2026-05-18 append) listed it among "3 parked OUT-OF-SCOPE proposals … each is its own kickoff." That kickoff was never written — terminal's reviewer lane was idling against a campaign with no committed spec. **This doc is that kickoff.** Until it lands there is no spec for `claude/web-phi-unlock-scenario`; do not author scenario content ahead of it.

The gap is named verbatim in the audit plan (`docs/audit/2026-05-17-mega-bot-audit-plan.md` §line 68): *"The encrypt/decrypt + one-passphrase cold-start path … is high-blast-radius. If no scenario drives encrypt/decrypt under realistic load, that is a named false-negative gap."* The audit (dimension **D2**) could only **confirm** the PHI surface is a blind spot — it could not test it. This scenario closes D2.

## 1. Scope

**IN** — one mega-bot scenario, persona-driven, that exercises the full PHI lifecycle under realistic load:
login → write patient/note/roster (PHI seals under the derived key) → simulated cold-start (key cleared from memory; sentinel + sealed rows persist on disk) → unlock gate renders → password entry → probe → backfill. **Both legs:** correct-password and wrong-password.

**OUT** — Tier-2 PHI re-encryption-on-rotation (audit plan §lines 29/151; separate design pending); cloud-side encrypted-blob runtime layer; any change to the PHI crypto or the v1.46.1 probe (green + shipped — this is *coverage of shipped code*, not feature work); bot rewrites; new chaos injectors.

## 2. Mechanism ground-truth (web-verified against source @ main 66f4d1a)

- `src/ui/hooks/usePhiGateState.ts:38-47` — gate state is `locked` iff *logged-in AND `hasPhiKey()` false AND `isPhiBackfillComplete()` truthy*. The backfill **sentinel** drives the gate; it is independent of whether genuinely-sealed rows exist on disk.
- `src/auth/phiUnlock.ts:65-80` — the v1.46.1 wrong-password probe verifies the just-derived key against **rows actually on disk** ("up to 3 sealed rows per store"). No sealed rows ⇒ nothing to verify against.

## 3. Design pin 1 — THE PROBE TRAP (load-bearing)

*Relayed by terminal's reviewer lane; verified by web against §2 above.*

A fixture that flips **only the sentinel** produces a `locked` gate **but seeds zero sealed rows for the probe to check**. The probe (`phiUnlock.ts:65-80`) then has nothing to verify against → it **cannot reject any password** → wrong-password is unreachable and any password is silently accepted. A scenario built that way would "pass" the wrong-password leg **without ever being capable of failing it** — a false-negative wearing a coverage badge. That is the exact D2 failure the audit warned about, reproduced one layer down.

**MANDATORY:** the wrong-password leg MUST seed **≥1 genuinely-sealed row** — real ciphertext sealed under a known-correct key (see `sealRow` usage in `tests/Unlock.test.tsx`), not a sentinel flip. If the scenario genuinely cannot seed a real sealed row, the wrong-password leg is **scoped out as a named residual** — never run sentinel-only under a coverage claim.

## 4. Design pin 2 — detector armed before trusted (Rule 6)

Before any GREEN from this scenario is trusted it must be seen RED on a known-broken build: locally revert / accept-always-stub the v1.46.1 probe and confirm the **wrong-password leg FAILS**. A scenario never observed to fail is not evidence — that is the component-contract half of the detector-trust rule. Record the RED run alongside the GREEN.

## 5. Design pin 3 — scenario, not unit test

This is a mega-bot **scenario** (persona-driven, runs alongside chaos injectors over the run window via `fixtureScenarioFor` / `generateScenarioOpus` in `scripts/ward-helper-mega-bot.mjs`), **not** a vitest. `tests/phiUnlock.test.ts` and `tests/Unlock.test.tsx` already cover the unit-level paths; the scenario's job is the **integration-under-load** D2 gap — concurrent writes, persona doing other work, chaos active — that no vitest reaches.

## 6. Success criteria

1. Drives the full lifecycle (seal → cold-start → gate → unlock → backfill) end-to-end inside a persona run.
2. **Correct-password leg:** gate clears, backfill completes, no orphaned rows.
3. **Wrong-password leg:** with ≥1 real sealed row seeded (§3), probe rejects, `wrong-password` outcome surfaces, gate persists, **no wrong-key writes**.
4. Detector armed (§4): scenario observed RED on the probe-reverted build before any GREEN is reported.
5. Pre-commit gate: landing does not regress the locked vitest baseline (1261 passed | 1 skipped at land time) or the build-size ceiling.

## 7. Lane plan

- **Web** authors the scenario + deterministic fixture (`fixtureScenarioFor` extension, or a new `scenPhiColdUnlock`).
- **Terminal** reviews filesystem-grounded, runs `check`/`test`/`build` delta vs the locked baseline, lands.
- The **stochastic run** (real-Opus scenario-gen mode) is a separate spend-gated kickoff — not bundled with the landing.

## 8. Open questions — need a call before implementation

1. **Fixture-only, or also Opus-generated?** Recommendation: **fixture-only first.** The wrong-password leg needs *deterministic* seeding of a real sealed row under a known key — an Opus-generated chart cannot guarantee that. The probe trap (§3) effectively forces fixture mode for that leg.
2. **Which persona owns it?** PHI cold-start is a returning-user-on-a-new-device situation — it needs a persona that logs in fresh against pre-existing sealed data, not one mid-session. May warrant a dedicated persona rather than bolting onto an existing one.
