# Web Claude bring-up prompt

Copy-paste this whole document into a fresh **claude.ai** conversation
to bring web Claude up to speed on ward-helper + the bot work.

---

## Project context

**ward-helper** is a mobile-first Hebrew RTL PWA for SZMC ward rounds.
Live at `https://eiasash.github.io/ward-helper/`. React 18 + TS + Vite.
Single-user, local-first IndexedDB, ciphertext-only Supabase backup.

The user (Eias) is a geriatrics fellow at Shaare Zedek Medical Center in
Jerusalem. He uses ward-helper on his iPhone in the ward to:
1. Photograph an AZMA EMR patient chart screen.
2. Get a Hebrew clinical note (admission / SOAP / discharge / consult).
3. Paste it into Chameleon EMR via a sanitized clipboard.

## Architecture invariants (NEVER break)

- **Toranot proxy is the model gateway.** All Claude API calls go through `https://toranot.netlify.app/api/claude` with shared secret `shlav-a-mega-1f97f311d307-2026`. **Do NOT re-add `@anthropic-ai/sdk`** to the client — it added 12 KB to the bundle and doesn't work through the proxy.
- **No PHI off device.** Supabase stores AES-GCM 256 ciphertext only. PBKDF2 ≥ 600 000 iters.
- **wrapForChameleon is the clipboard boundary.** Every clipboard write must go through `src/i18n/bidi.ts::wrapForChameleon` which runs `sanitizeForChameleon` first. Arrows (→ ↑ ↓), `**bold**`, `--`, `>N`, `q8h`/`bid` corrupt Chameleon EMR.
- **Version trinity** — `package.json.version` ↔ `public/sw.js VERSION` must match. Sibling medical PWAs (Geri/IM/FM) also have `src/core/constants.js APP_VERSION`. Pre-push hook + CI verify.
- **Mobile file inputs use `<label>`-wrapped `.visually-hidden` pattern.** Programmatic `ref.click()` on hidden inputs fails silently in PWA standalone mode on mobile Chrome.
- **Single Supabase project** `krmlzwwelqvlfslwltol` shared with Toranot, Geriatrics, InternalMedicine, FamilyMedicine. Never cross-wire to watch-advisor2's `oaojkanozbfpofbewtfq`.

## Current state (as of 2026-05-10)

- Live version: **v1.44.0**
- 1038 vitest cases passing (across 102 files, 1 skipped live-eval gated on `ANTHROPIC_API_KEY`)
- Entry chunk 81.06 kB gzipped (45% of 180 kB CI ceiling)
- Five SZMC skills bundled in `public/skills/`: azma-ui, szmc-clinical-notes, szmc-interesting-cases, hebrew-medical-glossary, geriatrics-knowledge
- Routes: `/capture`, `/review`, `/edit`, `/save`, `/today`, `/consult`, `/history`, `/note/:id`, `/census`, `/settings`, `/ortho`, `/reset-password`
- Email-to-self LIVE — Save + Consult screens; Gmail OAuth from `GMAIL_FROM` env on Supabase Edge Function `send-note-email`
- SOAP-mode UI gated on `localStorage.batch_features === '1'`
- Cloud password reset Tier 2 LIVE; pending `RESEND_API_KEY` config (until then HTTP 503 + falls back to admin SQL Tier 1)

## Bot infrastructure (2026-05-08 → 2026-05-10)

Two complementary bots in `scripts/`:

### `ward-helper-bot-v1.mjs` — single-shot scenario harness
- Generates 1 synthetic patient via Opus 4.7 + adaptive thinking.
- Runs sub-bot sequence: admission emit / SOAP / discharge / choppy upload / mobile layout audit / 50MB upload / minimal PDF / 1×1 PNG / census photo / roster import.
- Cost: ~$1.50 per scenario at effort=medium, $20 cap default.

### `ward-helper-mega-bot.mjs` — N-persona parallel chaos runner
- 5-10 doctor personas in parallel browser contexts, iPhone 13 emulation.
- Each persona runs continuous weighted-random action loop for 30 min (configurable).
- Personas: speedrunner, methodical, misclicker, multitasker, keyboardWarrior, batterySaver, unicodeChaos.
- Action menu: admission emit / SOAP daily round / ortho calc / consult / history / settings.
- Chaos menu: back-button mash / visibility cycle / keyboard spam / random text input / IDB clear.
- Recovery layer (60s soft / 180s hard / 300s kill) absorbs misclicks.
- Renders synthetic patient charts to a self-contained HTML gallery at end.

### Run example
```bash
WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed CLAUDE_API_KEY=$KEY \
  WARD_BOT_PERSONAS=10 WARD_BOT_DURATION_MS=1800000 \
  CHAOS_EFFORT=high CHAOS_COST_CAP_USD=30 \
  CHAOS_HEADLESS=1 \
  CHAOS_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \
  node scripts/ward-helper-mega-bot.mjs
```

## What the 2026-05-10 mega-bot run found

**Run stats:** 30 min · 5 personas · 4 817 actions · 891 bugs (0C / 144H / 0M / 747L) · 747 watchdog recoveries · $0 cost (fixture mode).

### Real bugs found (and fixed)

1. **`Capture.tsx:760` rejected with `r.error` directly.** When chaos-clear-storage interrupted FileReader mid-read, `r.error` was null/undefined → 144 unhandled-rejections with `reason=undefined`. Every other FileReader site in the codebase already used `reject(r.error ?? new Error('...'))`; this was the lone holdout. **Fixed in v1.44.0 (PR #134).**

2. **Mobile `/today` header-strip overflow.** `<header.header-strip>` was 485 px wide on iPhone 13's 390 px viewport — caused horizontal body scroll, cascaded to "patient list button out of bounds" the user reported. **Fixed via `@media (max-width: 420px)` in v1.44.0 (PR #135).**

3. **SOAP "+SOAP" re-prompts for ID.** `applyRosterSeedFromStorage` updated `fields` but not `parsed.confidence` — `FieldRow.tsx` saw `confidence === undefined && critical=true` and rendered `אישור ידני נדרש` on every roster-sourced identity. **Fixed via new `applyRosterSeedFromStorageWithConfidence` in v1.44.0 (PR #135).**

### Bot-side issues found (and fixed in the bot)

- 567 LOW false-positives on `/ortho` from random-button-clicking compounding with misclicker's 20 % off-center rate. Tuned to click named buttons by aria-label.

## Lessons that generalize to sibling apps

The **SOAP confidence override pattern** is portable to **InternalMedicine** and **FamilyMedicine** if they have similar roster-seed flows. The **mobile header-strip media query** is portable to anywhere a `flex` row of N labels overflows narrow viewports. The **mega-bot persona harness** itself is portable — only the selectors + flows are app-specific; the recovery / chaos / persona / gallery layers are generic.

## What I want web Claude to help with

1. **Independent code review** of the mega-bot. The mega-bot is at `scripts/ward-helper-mega-bot.mjs` (orchestrator) + `scripts/lib/megaPersona.mjs` (personas + actions + chaos). What did terminal Claude miss? What's a better selector strategy? What's a better recovery escalation policy?

2. **Suggest 3-5 new chaos events** the mega-bot doesn't currently exercise. Specifically: things a real impatient doctor would do that we haven't simulated.

3. **Suggest 1-2 new persona archetypes** that would surface bug classes the current 7 don't reach.

4. **Review the patient-gallery output format.** Look at `scripts/lib/patientChart.mjs` and a sample chart at `chaos-reports/ward-bot-mega/wm-2026-05-10T17-13-37-patients/index.html`. Is the chart-card layout chart-rounds-friendly? What's missing?

5. **Sibling-app porting plan.** Geri/IM/FM probably have analogous bugs to the SOAP confidence one. What's the cheapest way to detect+fix across the trio without re-running the full bot per repo?

## Coordination protocol

I (terminal Claude) and you (web Claude) sometimes work on the same repo simultaneously. Use the source-tagged branch convention:
- `claude/term-*` for my work
- `claude/web-*` for yours
- Never push directly to main — branch protection enforces, but use PRs anyway for visibility.
- At session start, run `git fetch --all && git log --all --since="1 day ago" --oneline` to see what the other has been doing.
- At session end, state in-flight branches/PRs explicitly.

## Files to read first

- `CLAUDE.md` (project root) — invariants
- `scripts/ward-helper-mega-bot.mjs` — orchestrator
- `scripts/lib/megaPersona.mjs` — persona + chaos library
- `chaos-reports/ward-bot-mega/wm-2026-05-10T17-13-37.md` — baseline run report
- `chaos-reports/ward-bot-mega/wm-2026-05-10T17-13-37-patients/index.html` — sample patient gallery (open it; the user wants this format kept)
- `chaos-reports/ward-bot-mega/NEXT-SESSION-PROMPT.md` — what terminal Claude is going to run next time

Now: read those, propose your contribution (review + 3-5 new chaos + 1-2 new personas + sibling-port plan + gallery feedback), and we'll iterate.
