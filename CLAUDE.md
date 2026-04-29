# CLAUDE.md — ward-helper

Mobile-first Hebrew-RTL PWA for SZMC ward rounds. Camera an AZMA screen → reviewed Hebrew note → paste to Chameleon. Single-user, proxy-based Claude access (no BYO key), local-first IndexedDB, encrypted Supabase backup.

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
- Service worker caches `index.html` — bump `VERSION` in [public/sw.js](public/sw.js) to match `package.json` on every release so installed PWAs pick up the new bundle hash.

## Architecture

Client-only React + TS + Vite. No server owned by this app. Static bundle deployed to GitHub Pages at `/ward-helper/`. Claude accessed via the Toranot proxy (`toranot.netlify.app/api/claude`, shared secret header). Supabase client called direct from browser for ciphertext-only blob storage.

Four SZMC skills bundled as static markdown in `public/skills/`:
- `azma-ui` — AZMA EMR interface reference (extract turn)
- `szmc-clinical-notes` — admission / discharge / consult format (emit turn for types 1-3)
- `szmc-interesting-cases` — case conference format (emit turn for type 4)
- `hebrew-medical-glossary` — bidi + Hebrew medical terminology (every turn)

`scripts/sync-skills.mjs` copies the full skill directory from `~/.claude/skills/<n>/` at prebuild time. Override source with `SKILL_SOURCE` env var.

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
