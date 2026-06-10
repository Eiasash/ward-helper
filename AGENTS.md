# AGENTS.md — ward-helper

Clinical ward tool for SZMC: AZMA census/EMR screenshot → Hebrew clinical note → paste to Chameleon EMR. Live: https://eiasash.github.io/ward-helper/
Stack: React 18 + TypeScript + Vite. Hebrew RTL. **NOT a quiz app** — no question bank.

## Setup & commands
```bash
npm ci
npm run dev
npm run check      # typecheck + lint
npm test           # vitest
npm run build      # → dist/
```
Node ≥ 22. Run `npm run check && npm test && npm run build` (all green) before any PR.

## HARD RULES (do not violate)
1. **Branch `codex/<slug>` → PR. NEVER push to `main`** (Pages deploys `main`).
2. **Version sync:** bump `package.json` "version" and the `sw.js` (and `public/sw.js`) `CACHE` key in lockstep — a mismatched cache marker masks shipped fixes behind the browser cache.
3. **PHI / crypto / auth are off-limits without explicit sign-off.** This app stores patient data with LOCAL encrypted-at-rest blobs and talks to a shared Supabase project. Do NOT refactor the encryption, the IndexedDB roster schema, the auth/login paths, or the Supabase wiring. If a change touches any of these, STOP and describe it for Eias's review first (codeowners-gated).
4. **Never re-add direct `api.anthropic.com` calls from the client** — CSP blocks them and mobile Chrome stalls on multi-MB bodies. AI goes through the Toranot proxy (`toranot.netlify.app/api/claude`); keys are server-side. Never commit secrets — use `${ENV_VAR}`.
5. **Chameleon clipboard boundary:** `src/i18n/bidi.ts` (`wrapForChameleon`/`sanitizeForChameleon`) is the ONLY place RLM/LRM marks are injected — arrows, `**bold**`, `--`, `>N`/`<N`, `q8h`/`bid` corrupt Chameleon. Don't touch this casually.
6. **Two photo prompts exist** (`OCR_SYSTEM_PROMPT` for roster, `CENSUS_JSON_INSTRUCTIONS` for census) — if you change OCR behavior, change BOTH.
7. **Hebrew RTL:** UTF-8 as-is, never transliterate; `dir="auto"` + `unicode-bidi:plaintext`.

## Good first tasks (UI/UX only — this is the priority)
Mobile-RTL fix pass: broken layout/overflow, contrast-AA, tap targets <44px, dark mode, console errors. Small UX wins: loading/empty/error states, auth-error messages that surface code+message (not a bare "שגיאה"), focus order, and a quick census glance (counts by ward/status). Anything near PHI/crypto/auth/sync → flag for review, don't implement. Report each change with before/after.
