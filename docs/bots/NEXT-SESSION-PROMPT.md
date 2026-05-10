# Next-session prompt — ward-helper bot iteration

Copy-paste this into a fresh Claude Code session at `C:\Users\User\repos\ward-helper`.

---

## Prompt

I want you to run another mega-bot pass on ward-helper, but smarter than the last one.
Read the lessons-learned section below first, then propose what to add before launching.

### Lessons learned from the 2026-05-10 run (must-incorporate)

1. **Bot triage queues have high false-positive rates.** Before claiming any flag is a real bug, verify against disk: grep the code path, check the actual button label, confirm the feature flag state. The first run flagged 4 "bugs" — all were bot-side selector issues.

2. **The 4 diagnostic hooks (`attachDiagnostics`) are gold.** `console.warning`, `page.crash`, `unhandledrejection`, `securitypolicyviolation` + `slow-ack` budget. Keep them. Don't gate them behind config — they're cheap and catch a class of failures vitest can't see.

3. **Recovery layer (60s soft / 180s hard / 300s kill) is non-negotiable for >5 min runs.** 747 stuck-state recoveries absorbed in 30 min without losing the run.

4. **Persona diversity matters more than persona count.** 5 personas with different timing/click patterns surfaced more bug classes than the same persona ×10 would. Speedrunner found the FileReader race because chaos-clear-storage interleaved with rapid uploads — Methodical never reached the chaos branch enough times.

5. **Random clicking inside complex screens compounds with misclicker's 20% miss rate.** scenOrthoCalc was clicking 3 random buttons → 567 LOW false-positives. Tuned to click named buttons by aria-label → 0 noise. Apply this lesson elsewhere: NEVER use `allBtns.nth(random)` in a sub-bot.

6. **Live-witness verification is mandatory.** After merge, curl `https://eiasash.github.io/ward-helper/sw.js | grep "ward-v$VERSION"` before claiming "shipped".

7. **Version trinity must match.** `package.json.version` ↔ `public/sw.js VERSION` ↔ (in sibling apps) `src/core/constants.js APP_VERSION`. Pre-push hooks enforce.

8. **Auto-merge is disabled on this repo.** Use `gh pr merge $N --squash --delete-branch` after CI green; not `--auto`.

### What's still untested (priority order)

- **Real Opus extract pipeline under load** (fixture mode skipped this — proxy may have its own race conditions)
- **Email-to-self flow on /save** (recently shipped, never bot-tested)
- **Morning-rounds-prep flow** (v1.40+ shipped, never bot-tested)
- **Cross-tab race** (2 personas in same browser context, edit same patient)
- **Network throttling chaos** — slow-3G via CDP `setOfflineMode` / `emulateNetworkConditions`
- **/reset-password landing page** — token-redemption flow
- **IDB quota stress** — fill IDB to quota, verify graceful handling
- **Service worker swap mid-session** — bump VERSION mid-run, verify no stale-cache bug
- **Ortho calc UI: POD calc + suture date math + DVT prophylaxis logic** (currently we only test the copy buttons)

### What I want you to do

1. Brainstorm-skill first. Don't just rerun. Use `superpowers:brainstorming` to align on what to add.
2. Add the missing chaos types above (network throttle is the biggest gap).
3. Add 2-3 new sub-bots covering email-to-self / morning-rounds-prep / reset-password.
4. Run with **10 diversified personas, 30 min, real Opus 4.7 (not fixture), CHAOS_EFFORT=high**.
5. After the run, render the new patient gallery + write a comparison report vs the 2026-05-10 baseline.

### Feedback loop — what to tell me about the bot's design

After the run, report:
- Which sub-bots produced ≥80% real signal (vs noise)?
- Which personas were "bad value" — high action count, low unique-bug yield?
- Which chaos events were redundant vs each other?
- What 1-2 new fixture scenarios would expose flows neither current persona is hitting?

This is a diff of our prior assumptions. I want to update the bot's design based on empirical persona-level signal, not theoretical coverage.

### Feedback to web Claude

When you're done, also write a 1-paragraph summary of "what this run found that the v1 mega-bot didn't" so I can paste it into web Claude to keep them in sync. Include the new bug count, the new gallery URL, and any architectural patterns that would benefit sibling apps (Geri / IM / FM).

### Hard constraints

- Stay on a feature branch (`claude/term-mega-bot-v4`-something). PR-based deploy.
- Cost cap $30. Stop early if we hit it. Don't override.
- Confirm CI green via `gh pr view --json statusCheckRollup` before merge.
- Live-witness with verify-deploy.sh OR manual `curl + grep` before claiming "shipped".
- Patient gallery rendering + persistence to `chaos-reports/ward-bot-mega/$RUN_ID-patients/` is mandatory — that's the user-visible deliverable.

### Files to read first

- `scripts/ward-helper-mega-bot.mjs` — orchestrator
- `scripts/lib/megaPersona.mjs` — personas + actions + chaos
- `scripts/lib/scenarioGen.mjs` — Opus 4.7 generator
- `scripts/lib/patientChart.mjs` — gallery renderer
- `scripts/lib/diagnostics.mjs` — page hooks
- `chaos-reports/ward-bot-mega/wm-2026-05-10T17-13-37.md` — baseline run report
- `CLAUDE.md` — invariants (especially the version trinity + verify-deploy)

Now plan the additions, propose them to me, then execute once I confirm.
