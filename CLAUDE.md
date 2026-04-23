# CLAUDE.md — ward-helper

Mobile-first Hebrew-RTL PWA for SZMC ward rounds. Camera an AZMA screen → reviewed Hebrew note → paste to Chameleon. Single-user, BYO Anthropic key, local-first IndexedDB, encrypted Supabase backup.

## Commands
- `npm run dev` — Vite dev server on 5173 (path base `/ward-helper/`)
- `npm test` — vitest run
- `npm run check` — `tsc --noEmit`
- `npm run build` — prebuild (skill sync) + tsc + vite build
- `node scripts/sync-skills.mjs` — refresh `public/skills/` from `~/.claude/skills/`

## Invariants — do not break

- Screenshots never written to any storage. In-memory only, revoked via `URL.revokeObjectURL` after API call.
- No plaintext PHI leaves the device. Supabase stores AES-GCM 256 ciphertext only.
- PBKDF2 ≥ 600,000 iterations (constant `PBKDF2_ITERATIONS` in [src/crypto/pbkdf2.ts](src/crypto/pbkdf2.ts)).
- CSP meta in `index.html` locks `connect-src` to `self` + `api.anthropic.com` + `*.supabase.co`.
- No analytics, no 3rd-party scripts (CI grep enforces).
- Main chunk ≤ 150 kB gzipped (CI enforces).

## Architecture

Client-only React + TS + Vite. No server. Static bundle deployed to GitHub Pages at `/ward-helper/`. Anthropic Messages API called direct from browser with BYO key (XOR-encrypted in localStorage). Supabase client called direct from browser for ciphertext-only blob storage.

Four SZMC skills bundled as static markdown in `public/skills/`:
- `azma-ui` — AZMA EMR interface reference (parse_azma_screen turn)
- `szmc-clinical-notes` — admission / discharge / consult format (emit_note turn for types 1-3)
- `szmc-interesting-cases` — case conference format (emit_note turn for type 4)
- `hebrew-medical-glossary` — bidi + Hebrew medical terminology (every turn)

`scripts/sync-skills.mjs` copies the full skill directory from `~/.claude/skills/<name>/` at prebuild time. Override source with `SKILL_SOURCE` env var.

## Bidi (mixed Hebrew / English)

Hebrew clinical prose embeds English drug names, acronyms, lab abbreviations. Never transliterate. At the clipboard boundary only, `src/i18n/bidi.ts::wrapForChameleon` inserts RLM/LRM marks. In storage and UI, strings are stored as-is UTF-8 with `dir="auto"` + `unicode-bidi: plaintext` on containers.

## Data model

- **IndexedDB** (on device, full PHI, source of truth): `patients`, `notes`, `settings`
- **Supabase** `ward_helper_backup` (ciphertext only, RLS per user): `{ user_id, blob_type, blob_id, ciphertext, iv, salt }`

## Spec & plan

- [docs/superpowers/specs/2026-04-22-ward-helper-design.md](docs/superpowers/specs/2026-04-22-ward-helper-design.md)
- [docs/superpowers/plans/2026-04-22-ward-helper-v1.md](docs/superpowers/plans/2026-04-22-ward-helper-v1.md)
