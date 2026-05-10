# CLAUDE.md — ward-helper

<!-- working-rules-v1:start -->
## Working Rules (user-mandated, non-negotiable)

These four rules are the floor. They override any conflicting guidance later in this file. If a rule conflicts with what you're about to do, stop and surface it before proceeding.

1. **Don't assume. Don't hide confusion. Surface tradeoffs.**
2. **Minimum code that solves the problem. Nothing speculative.**
3. **Touch only what you must. Clean up only your own mess.**
4. **Define success criteria. Loop until verified.**
<!-- working-rules-v1:end -->

Mobile-first Hebrew-RTL PWA for SZMC ward rounds. Camera an AZMA screen → reviewed Hebrew note → paste to Chameleon. Single-user, proxy-based Claude access (no BYO key), local-first IndexedDB, encrypted Supabase backup.

## Snapshot (last audit 2026-05-10, v1.42.0 + ortho-rehab content drop)

- **1020 vitest cases passing across 99 files** (+ 1 skipped live-eval gated on `ANTHROPIC_API_KEY`)
- Entry chunk **~134.65 kB** gzipped (74.8% of 180 kB CI ceiling)
- Total assets gz ~199 kB (~49.8% of 400 kB CI ceiling)
- All 8 CI gates green; skill drift between `~/.claude/skills/` and `public/skills/` = none (5 skills synced incl. `geriatrics-knowledge`)
- Coverage: total statements 65.34%, branches 80.96% (UI gap by design — covered by Playwright `ward-helper-bot-v1`)
- Tests pinned to `TZ=Asia/Jerusalem` via `cross-env` (added 2026-05-10 alongside the orthoCalc TZ-regression block)
- See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the full audit log

## Commands
- `npm run dev` — Vite dev server on 5173 (path base `/ward-helper/`)
- `npm test` — vitest run
- `npm run check` — `tsc --noEmit`
- `npm run build` — prebuild (skill sync) + tsc + vite build
- `node scripts/sync-skills.mjs` — refresh `public/skills/` from `~/.claude/skills/`

## Deploy flow
PR-based. Do not push directly to main. Open a draft PR, let CI run,
mark ready when green, merge via squash. Branch protection enforces this.

## Invariants — do not break

- Screenshots never written to any storage. In-memory only, revoked via `URL.revokeObjectURL` after API call.
- Screenshots are downsized by [src/camera/compress.ts](src/camera/compress.ts) at capture (1600px long edge, JPEG q=0.85) before entering the session. Full-res PNGs from phone cameras stall mobile Chrome POSTs — the 20x size reduction is what makes the extract call reliable.
- No plaintext PHI leaves the device. Supabase stores AES-GCM 256 ciphertext only.
- PBKDF2 ≥ 600,000 iterations (constant `PBKDF2_ITERATIONS` in [src/crypto/pbkdf2.ts](src/crypto/pbkdf2.ts)).
- CSP meta in `index.html` allows `connect-src` from `self` + `api.anthropic.com` + `toranot.netlify.app` + `*.supabase.co`. The proxy is the default path (Settings has a live indicator + toggle); direct Anthropic calls from mobile Chrome stall on multi-MB bodies, so don't make the direct path the default.
- No analytics, no 3rd-party scripts (CI grep enforces).
- Entry chunk ≤ 180 kB gzipped, total JS assets ≤ 400 kB gzipped (CI enforces both — see `.github/workflows/ci.yml`). Budget was raised from 150 kB to give headroom for the lazy-loaded route + drug-safety engine.
- File inputs on mobile **must** use the `<label>`-wrapped pattern with `.visually-hidden` styling. Never use programmatic `ref.click()` on hidden inputs — it fails silently on mobile Chrome in PWA standalone mode.
- Every string copied to the Chameleon clipboard must flow through `wrapForChameleon` (in [src/i18n/bidi.ts](src/i18n/bidi.ts)), which runs `sanitizeForChameleon` first. Arrows (→ ↑ ↓), `**bold**`, `--`, `>N`/`<N`, and `q8h`/`bid` all corrupt Chameleon — the sanitizer is the last line of defense.
- Supabase project is pinned to `krmlzwwelqvlfslwltol` (shared "Toranot" project — also used by Toranot, FamilyMedicine, Geriatrics, InternalMedicine). Never cross-wire to watch-advisor2's `oaojkanozbfpofbewtfq`. [tests/supabase-config.test.ts](tests/supabase-config.test.ts) enforces this.
- Per-note-type prompt prefixes in [src/notes/orchestrate.ts](src/notes/orchestrate.ts) mirror the printed-output order from `szmc-clinical-notes` skill. SOAP is written "in the spirit of a consult" — brief, problem-focused, plan-heavy. Do not change prefix order without updating the skill.
- Model access is via [src/agent/client.ts](src/agent/client.ts) → `callProxy()` → `toranot.netlify.app/api/claude` (shared secret `shlav-a-mega-1f97f311d307-2026`). The proxy strips `tools`/`tool_choice` fields, so structured output uses JSON-mode prompting. See [src/agent/loop.ts](src/agent/loop.ts) — `runExtractTurn` / `runEmitTurn` parse strict JSON from `content[].text`. **Do not re-introduce `@anthropic-ai/sdk`** — it added ~12 KB to the bundle and doesn't work through the proxy.
- Extract prompt emits `confidence` for the critical-3 identifiers only (name / teudatZehut / age). Adding more fields re-introduces the 10s-budget stall the slim commit fixed. `sourceRegions` has been retired — don't re-add it.
- Per-patient cost attribution: `Capture.tsx` opens a session via `startSession()` on mount; `saveBoth()` calls `finalizeSessionFor(patientId)` after IndexedDB put. Any new entry point that creates a note must follow the same open/finalize pair, or the tokens go unattributed.
- Bidi audit banner in NoteEditor is a dev affordance only — gated behind the Settings toggle that writes `ward-helper.bidiAudit=1` to localStorage. It must not be visible by default; `wrapForChameleon` is the clinical safety net.
- Service worker caches `index.html` — bump `VERSION` in [public/sw.js](public/sw.js) to match `package.json` on every release so installed PWAs pick up the new bundle hash. The `swVersionSync` Vite plugin in `vite.config.ts` rewrites `dist/sw.js` at build to `ward-v<package.json.version>`, so cosmetic drift in source `public/sw.js` is harmless — but a missing `VERSION` line throws and blocks the build.

## Release Invariants (run before declaring "shipped")
1. **Local checks** — `npm run check` (tsc) + `npm test` + `npm run build`. All must be green.
2. **PR + CI** — push branch, open draft PR, let CI run all 13 gates (do NOT push direct to main).
3. **Live witness** — after merge + Pages publishes (~60–90s), `bash scripts/verify-deploy.sh` curls `https://eiasash.github.io/ward-helper/sw.js` and asserts the new `ward-v<version>` line is live. **Don't claim "deployed" until this passes** — local build success ≠ live deploy success.
4. **Source-of-truth note**: source `public/sw.js` may legitimately lag (e.g., source says `ward-v1.29.0` while `package.json` says `1.32.0`) because the Vite plugin rewrites at build. Trust `verify-deploy.sh` over the source file.

## Architecture

Client-only React + TS + Vite. No server owned by this app. Static bundle deployed to GitHub Pages at `/ward-helper/`. Claude accessed via the Toranot proxy (`toranot.netlify.app/api/claude`, shared secret header). Supabase client called direct from browser for ciphertext-only blob storage.

Five SZMC skills bundled as static markdown / JSON in `public/skills/`:
- `azma-ui` (R4) — AZMA EMR interface reference (extract + census turns). Includes:
  - `SKILL.md` (5.7 KB) — skill manifest with trigger phrases for the order grid + 7-icon legend
  - `AZMA_REFERENCE.md` (21.4 KB) — column-by-column reference for the patient-list grid (1-21), color codes, the §7 4-axis read for the medication-orders grid, manifest-grade quiz answers
  - `azma_reference.json` (43.9 KB) — structured lookup with `manifestEvidence` + `provenance` per quiz answer
- `szmc-clinical-notes` — admission / discharge / consult format (emit turn for those 3 types)
- `szmc-interesting-cases` — case conference format (emit turn for type 4)
- `hebrew-medical-glossary` — bidi + Hebrew medical terminology (every turn)
- `geriatrics-knowledge` — clinical reasoning corpus: STOPP/START, Beers, AKI/CKD dosing, capacity law (ייפוי כוח מתמשך / מקבל החלטות זמני), driving fitness, antibiotic selection. Loaded into the emit turn for admission/discharge/consult.

`scripts/sync-skills.mjs` copies skills from `~/.claude/skills/<n>/` at prebuild time using a per-skill file whitelist (defined in the script + mirrored in `src/skills/loader.ts` `SKILL_FILES`). Decorative / verification-only files in the source dir (e.g. azma-ui's `slide_art/` directory of decorative slide backgrounds, `manifest.json`'s 198 KB SCORM source) are intentionally excluded from the bundle. Override source with `SKILL_SOURCE` env var.

### Sync flow with claude.ai web project skills

When you update a skill in your claude.ai project and want ward-helper to pick it up:

1. Re-download the `.skill` ZIP from claude.ai (or extract one from a packaged drop, e.g. `E:\Downloads\<name>.skill`)
2. Extract into `~/.claude/skills/<name>/` (overwriting the old version). For multi-file bundles like azma-ui R4, the source folder will contain SKILL.md + companion files; ward-helper's whitelist only takes the runtime-relevant ones.
3. `cd ward-helper && npm run build` → `scripts/sync-skills.mjs` runs as prebuild and copies the source-of-truth into `public/skills/`. Per-file text patches (e.g. swapping out `project_knowledge_search` references for `geriatrics-knowledge` since that tool isn't in the runtime) are applied in the same pass.
4. `git push` → GitHub Pages auto-deploy → next clinical session sees the new skill.

Adding a NEW skill: add an entry to `SKILL_FILES` in BOTH `scripts/sync-skills.mjs` and `src/skills/loader.ts`, plus extend the `SkillName` type. If the skill needs runtime adjustments (instructions for non-runtime tools), add an entry to `SKILL_PATCHES` in sync-skills.mjs.

## Bidi (mixed Hebrew / English)

Hebrew clinical prose embeds English drug names, acronyms, lab abbreviations. Never transliterate. At the clipboard boundary only, `src/i18n/bidi.ts::wrapForChameleon` inserts RLM/LRM marks. In storage and UI, strings are stored as-is UTF-8 with `dir="auto"` + `unicode-bidi: plaintext` on containers.

## Data model

- **IndexedDB** (on device, full PHI, source of truth): `patients`, `notes`, `settings`
- **Supabase** `ward_helper_backup` (ciphertext only, RLS per user): `{ user_id, blob_type, blob_id, ciphertext, iv, salt }`

## Spec & plan

- [docs/superpowers/specs/2026-04-22-ward-helper-design.md](docs/superpowers/specs/2026-04-22-ward-helper-design.md)
- [docs/superpowers/plans/2026-04-22-ward-helper-v1.md](docs/superpowers/plans/2026-04-22-ward-helper-v1.md)
- [docs/superpowers/specs/2026-04-23-soap-daily-followup-design.md](docs/superpowers/specs/2026-04-23-soap-daily-followup-design.md)
- [docs/superpowers/plans/2026-04-23-soap-daily-followup.md](docs/superpowers/plans/2026-04-23-soap-daily-followup.md)

## Operations runbooks

### Lost password — admin-mediated reset (Tier 1, ship-ready)

The auth scheme is username-only — there's no email-based self-service reset yet (Tier 2, not built). When a user forgets their password, the admin (you) resets it directly via Supabase SQL:

1. Open the Supabase SQL Editor for project `krmlzwwelqvlfslwltol` (the shared Toranot project — ward-helper auth lives in the cross-app `app_users` table).
2. Run:

   ```sql
   -- Replace 'username' and 'newPassword' with actual values.
   -- bcrypt cost factor 10 matches what auth_register_user uses.
   UPDATE app_users
   SET password_hash = crypt('newPassword', gen_salt('bf', 10))
   WHERE username = 'username';
   ```

3. Confirm the row was updated (`UPDATE 1`).
4. Tell the user to log in with the new password, then change it via Settings → Account.

**Failure modes & fixes:**
- `0 rows updated` → username typo (usernames are stored lowercase per `USERNAME_RE` in `src/auth/auth.ts`). Run `SELECT username FROM app_users WHERE username ILIKE 'eias%'` to find the actual stored value.
- `function crypt does not exist` → use the schema-qualified form: `extensions.crypt(...)` and `extensions.gen_salt(...)`. pgcrypto lives in the `extensions` schema, not `public`. (See `feedback_supabase_function_search_path_extensions.md` in memory.)
- `column "X" does not exist` → the schema has no lockout columns (`failed_attempts`, `locked_out_until` were planned but never shipped). The minimal UPDATE is just `password_hash`. Confirmed live 2026-05-07 — `42703` error rejected the older runbook variant; trimmed clause works.

### Self-service password reset — Tier 2 (SHIPPED 2026-05-02, pending RESEND_API_KEY)

Backend live (schema + 3 RPCs + Edge Function `send-password-reset`). Client UI shipped in PR #41 — "שכחת סיסמה?" link on login form + `/reset-password` route handles token redemption.

**One-time config still required before working end-to-end:** set `RESEND_API_KEY` secret on Supabase Edge Functions (`supabase secrets set RESEND_API_KEY=re_...`). Until then, requests return HTTP 503 `email_not_configured` and the client shows a clear message — fall back to the Tier 1 runbook above.

Full deployment notes (RPC list, anti-enumeration design, token lifecycle, cross-sibling porting plan) live in memory file `project_ward_helper_password_recovery.md`.
