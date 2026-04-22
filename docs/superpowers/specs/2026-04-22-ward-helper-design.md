# ward-helper v1 — Design

**Date:** 2026-04-22
**Status:** Approved for planning
**Author:** Eias Ashhab (brainstormed with Claude)

---

## 1. Problem & goal

SZMC ward rounds generate four document types daily: admission notes (קבלה רפואית), discharge summaries (סיכום שחרור / אשפוז), consultation letters (ייעוץ), and case-conference summaries (מקרה מעניין / ישיבת מקרים). All are authored by hand from AZMA / Chameleon EMR data and pasted back into Chameleon. ward-helper is a mobile-first PWA that shortens this loop to: **photograph AZMA → review parsed fields → edit draft → paste to Chameleon**.

### Goals (v1)
- Single-user mobile PWA, Hebrew-RTL primary with proper bidi for embedded English medical terminology
- Camera capture (primary) + paste-text fallback (secondary)
- All four SZMC note formats generated via bundled skills
- Local-first patient history on device, encrypted cloud backup for disaster recovery
- BYO Anthropic API key, zero server-side infrastructure
- Mandatory human review between extraction and note emission

### Non-goals (v1)
- Voice dictation (v2)
- Multi-user or team features
- Real EMR integration (Chameleon API)
- Desktop-first layout (desktop works, but not optimized)
- Push notifications
- Offline Claude inference

---

## 2. Architecture

Client-only React + TypeScript + Vite PWA. No server. Static bundle deployed to GitHub Pages. The Anthropic Messages API is called directly from the browser with the user's BYO API key (XOR-encrypted in localStorage using a device-derived secret — the Watch Advisor pattern). The Supabase JS client is called directly from the browser for ciphertext-only blob storage (ward-helper never sends plaintext PHI to Supabase).

Four SZMC skills are bundled as static `.md` assets in `public/skills/` and loaded at runtime. The skill text is injected into the system prompt for every Claude turn, so improvements to the skill files propagate without a code change.

```
┌──────────────────────────────────────────────────────┐
│  ward-helper PWA (GitHub Pages static bundle)        │
│                                                      │
│  React + TS + Vite   ──────  Vitest + CI             │
│       │                                              │
│       ├── src/agent ───── api.anthropic.com          │
│       │                   (BYO key, direct)          │
│       │                                              │
│       ├── src/storage/indexed.ts ── IndexedDB        │
│       │                   (full PHI, device-only)    │
│       │                                              │
│       └── src/storage/cloud.ts ──── *.supabase.co    │
│                           (AES-GCM ciphertext only)  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 3. Module structure

```
ward-helper/
├── public/
│   ├── skills/
│   │   ├── azma-ui.md
│   │   ├── szmc-clinical-notes.md
│   │   ├── szmc-interesting-cases.md
│   │   └── hebrew-medical-glossary.md
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
├── src/
│   ├── agent/
│   │   ├── client.ts          # Anthropic Messages API client + streaming
│   │   ├── tools.ts           # parse_azma_screen, emit_note, lookup_patient
│   │   ├── loop.ts            # 2-turn extract → review → emit orchestration
│   │   └── costs.ts           # token + $ accounting per turn
│   ├── skills/
│   │   └── loader.ts          # fetch + cache skill .md files at runtime
│   ├── camera/
│   │   ├── capture.tsx        # MediaDevices.getUserMedia + multi-shot session
│   │   └── discard.ts         # explicit blob URL revocation
│   ├── notes/
│   │   ├── types.ts           # NoteType = 'admission' | 'discharge' | 'consult' | 'case'
│   │   ├── templates.ts       # per-type skeleton + required fields
│   │   └── editor.tsx         # section-diff editor
│   ├── storage/
│   │   ├── indexed.ts         # IDB: patients, notes, settings
│   │   └── cloud.ts           # Supabase + AES-GCM encrypt/decrypt
│   ├── crypto/
│   │   ├── aes.ts             # AES-GCM 256 wrapper
│   │   ├── pbkdf2.ts          # PBKDF2 iter=600k → derive key from passphrase
│   │   └── xor.ts             # device-secret XOR for API key at rest
│   ├── i18n/
│   │   ├── strings.he.ts
│   │   └── bidi.ts            # RLM/LRM insertion, direction detection
│   ├── ui/
│   │   ├── screens/
│   │   │   ├── Capture.tsx
│   │   │   ├── Review.tsx       # non-bypassable extraction review
│   │   │   ├── NoteEditor.tsx
│   │   │   ├── History.tsx
│   │   │   └── Settings.tsx
│   │   └── components/
│   └── main.tsx
├── tests/
│   ├── agent.test.ts
│   ├── crypto.test.ts
│   ├── storage.test.ts
│   ├── bidi.test.ts
│   └── extraction/
│       ├── fixtures/                # synthetic AZMA screenshots
│       └── eval.test.ts             # accuracy eval harness
├── .github/workflows/
│   ├── ci.yml
│   ├── pages.yml
│   └── audit-fix-deploy.yml
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── CLAUDE.md
```

---

## 4. Agent flow (per note generation)

Every note is produced by a fixed 2-turn loop with a mandatory human-review gate between turns. The loop orchestrator lives in `src/agent/loop.ts`.

```
STEP 1  User selects note type on Capture screen
STEP 2  User captures 1–N AZMA screenshots (camera or paste)
STEP 3  Turn 1 — EXTRACT
          system = azma-ui.md + hebrew-medical-glossary.md
          user   = [images...] + "extract structured data + confidence"
          tool   = parse_azma_screen → {fields, confidence[], source_regions[]}
STEP 4  Review screen (MANDATORY, NON-BYPASSABLE)
          - Each field shown with confidence (red=low, yellow=med, green=high)
          - Low-confidence fields require explicit tap-to-confirm
          - Critical fields (meds, allergies, age, ID) trigger a 2nd-shot request
          - Contradictions across multiple shots shown side-by-side with timestamps
STEP 5  Turn 2 — EMIT
          system = {note-type skill} + hebrew-medical-glossary.md
          user   = validated structured data + "emit SZMC-format Hebrew note"
          tool   = emit_note → final Hebrew note text (bidi-correct)
STEP 6  NoteEditor screen — section-diff editing
STEP 7  User action:
          - "העתק" → clipboard.writeText(plain Hebrew note) for Chameleon paste
          - "שמור" → IndexedDB write (full PHI) + encrypted Supabase push
STEP 8  Screenshots released from memory (URL.revokeObjectURL)
          Never written to disk, IDB, or cloud.
```

---

## 5. Extraction accuracy guarantees

The single most load-bearing requirement: **extracted fields must be trusted before emitting a note**.

- **Review screen is a hard gate.** There is no "skip review" path. The UI enforces it.
- **Per-field confidence.** The `parse_azma_screen` tool schema requires a `confidence: "low" | "med" | "high"` for every field. UI color-codes red/yellow/green.
- **Source attribution.** Each parsed field carries a `source_region` hint (e.g., `"meds tab, row 3"`, `"ADT banner"`). Shown as a tooltip on hover/tap so you know where to look in AZMA if unsure.
- **Critical-field 2nd-shot rule.** meds, allergies, age/DOB, and teudat zehut: if only one screenshot covered them, the Review screen prompts for a second shot of that specific panel before the Emit turn is allowed.
- **Contradiction display.** If two screenshots give different values for the same field, both appear side-by-side with shot timestamps. User picks the canonical one.
- **CI eval harness.** `tests/extraction/fixtures/` holds synthetic AZMA screenshots + ground-truth JSON. `tests/extraction/eval.test.ts` runs the real extraction tool (with a mocked API that replays recorded Anthropic responses) and asserts accuracy ≥ 95% on critical fields. Breaks the build if it regresses.

---

## 6. Bidi — mixed Hebrew / English integration

Israeli medical notes are inherently bidirectional. Hebrew clinical prose wraps English drug names (Eliquis, Apixaban), English acronyms (CHF, COPD, ACB, CFS, CGA), Latin diagnoses (pneumonia, UTI), lab abbreviations (Cr, Na⁺, eGFR, BNP, HbA1c), and Latin digits. Getting bidi wrong makes a note look broken when pasted into Chameleon.

### Rules baked into v1

1. **UI layer**
   - Root `<html dir="rtl" lang="he">`
   - All text inputs: `dir="auto"` (browser follows the first strong character)
   - All read-only Hebrew text blocks: CSS `unicode-bidi: plaintext`, so each paragraph is treated in its own logical direction
   - Font stack: `Heebo` for Hebrew runs, `Inter` for Latin runs, both via Google Fonts; Latin digits preserved (no Arabic-Indic mapping)

2. **Agent output (system-prompt rules)**
   - System prompt for Turn 2 explicitly instructs Claude: *"Emit Hebrew clinical prose. Keep drug names, acronyms, and lab abbreviations in their standard English/Latin form. Insert RLM (U+200F) after any English run that is followed by a Hebrew punctuation mark, and LRM (U+200E) inside parentheses that contain only Latin content. Do not transliterate."*
   - Output sample: `המטופל קיבל Apixaban 5 mg ×2‎ (דרך הפה) החל מ-12.3.26.`

3. **Clipboard for Chameleon**
   - Copy = `clipboard.writeText(plainText)` with real Unicode RLM/LRM marks embedded (not HTML)
   - Chameleon's note textarea uses the system bidi algorithm; verified to render correctly with our markup during design
   - A dry-run "copy preview" in the NoteEditor renders the exact same plaintext in a `dir="auto"` read-only textarea so you see what Chameleon will see

4. **Data layer**
   - Strings stored in UTF-8 as-is; no direction marks injected into persistent storage
   - Marks are added only at the clipboard boundary by `src/i18n/bidi.ts::wrapForChameleon(text)`

5. **Bidi linter (unit test)**
   - `tests/bidi.test.ts` asserts on every sample note: (a) no unbalanced LRI/RLI/PDI, (b) English runs of length ≥ 3 at end-of-Hebrew-sentence are followed by RLM, (c) parenthesized all-Latin content is wrapped in LRM...LRM, (d) digits are Latin-only (no 0x0660 range)

6. **Extraction side**
   - `parse_azma_screen` must preserve original language per field. Drug names stay English; chief complaint stays Hebrew; ID stays Latin digits. A field value is never auto-translated.

---

## 7. Data model

### IndexedDB (on device, full PHI, source of truth)

```ts
// patients store
{
  id: string,                // local uuid
  name: string,              // Hebrew full name
  teudatZehut: string,       // 9-digit ID
  dob: string,               // YYYY-MM-DD
  room: string | null,
  tags: string[],            // user-assigned: e.g., ["ward-3", "follow-up"]
  createdAt: number,
  updatedAt: number
}

// notes store
{
  id: string,                // local uuid
  patientId: string,         // → patients.id
  type: 'admission' | 'discharge' | 'consult' | 'case',
  bodyHebrew: string,        // final Hebrew note, bidi-correct
  structuredData: object,    // the validated Review-screen payload (JSON)
  createdAt: number,
  updatedAt: number
}

// settings store (keyed singleton)
{
  apiKeyXor: Uint8Array,     // XOR-encrypted Anthropic key
  deviceSecret: Uint8Array,  // per-device random (first-run, never leaves device)
  lastPassphraseAuthAt: number | null,  // forces re-auth after N min idle
  prefs: { ... }
}
```

### Supabase (ciphertext only, RLS per user)

```sql
create table ward_helper_backup (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  blob_type    text not null check (blob_type in ('patient', 'note')),
  blob_id      text not null,        -- matches IndexedDB id, for merge-by-id
  ciphertext   bytea not null,       -- AES-GCM(JSON.stringify(record))
  iv           bytea not null,       -- 12-byte IV per row
  salt         bytea not null,       -- 16-byte salt for PBKDF2 (same per user after first write)
  version      int not null default 1,
  updated_at   timestamptz not null default now(),
  unique (user_id, blob_type, blob_id)
);

alter table ward_helper_backup enable row level security;
create policy "owner-only" on ward_helper_backup
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on ward_helper_backup (user_id, updated_at desc);
```

Supabase auth uses anonymous users (`supabase.auth.signInAnonymously`) on first launch; the passphrase is independent of Supabase auth and is used only to derive the AES key.

---

## 8. Security invariants

Every invariant below is asserted by at least one test or a CSP/CI check.

| Invariant | Mechanism |
|---|---|
| Screenshots never written anywhere | In-memory `Blob` + explicit `URL.revokeObjectURL` after Turn 1; unit test asserts IDB has no blob stores |
| Anthropic API key encrypted at rest | XOR with per-device 256-bit random secret; unit test asserts raw localStorage has no recognizable key prefix (`sk-ant-`) |
| Cloud passphrase never stored or synced | Held in memory only; auto-cleared after 15 min idle; re-prompt on return |
| All Supabase-bound data is AES-GCM 256 ciphertext | `src/storage/cloud.ts::push()` refuses plaintext; unit test round-trips encrypt/decrypt |
| PBKDF2 iteration count ≥ 600,000 | Enforced in `src/crypto/pbkdf2.ts` constant + unit test |
| CSP locks network origins | `<meta http-equiv="Content-Security-Policy" ...>` with `connect-src` = self + `api.anthropic.com` + `{project}.supabase.co`; CI grep asserts presence |
| No analytics, no 3rd-party scripts | CI greps for common analytics domains (google-analytics, sentry, posthog) and fails if found |

---

## 9. CI & deploy

- **Repo:** `Eiasash/ward-helper` (new, public)
- **GitHub Actions:**
  - `ci.yml` — `tsc --noEmit`, `vitest run`, `npm run build`, bundle-size gate (main chunk < 150 kB gzipped, mirrors Toranot), CSP presence check, no-analytics grep
  - `pages.yml` — build on push to `main`, deploy `dist/` to `gh-pages` branch
  - `audit-fix-deploy.yml` — reuse existing `audit-fix-deploy` skill pattern
- **Pages URL:** `https://eiasash.github.io/ward-helper/`
- **PWA:** installable via `manifest.webmanifest`, service worker for app-shell offline caching (app shell only — API calls require online)

---

## 10. Testing

| Test file | Scope |
|---|---|
| `tests/agent.test.ts` | Tool schemas, 2-turn loop, retry/backoff, cost accounting |
| `tests/crypto.test.ts` | AES-GCM round-trip, PBKDF2 iter count, XOR symmetry |
| `tests/storage.test.ts` | IDB CRUD, Supabase push/pull with mocked client, conflict-by-id merge |
| `tests/bidi.test.ts` | 20+ sample notes pass the bidi linter rules in §6 |
| `tests/extraction/eval.test.ts` | Accuracy ≥ 95% on critical fields against `fixtures/` ground truth |
| `tests/notes.test.ts` | Each of the 4 note types produces all required sections |

Target: ~100 tests at v1 ship.

---

## 11. Skill wiring

| Skill | File | Used for | Loaded at |
|---|---|---|---|
| `azma-ui` | `public/skills/azma-ui.md` | Parse AZMA screenshots (regions, icons, colors, tabs) | every Turn 1 |
| `szmc-clinical-notes` | `public/skills/szmc-clinical-notes.md` | Emit admission / discharge / consult | Turn 2 for note types 1–3 |
| `szmc-interesting-cases` | `public/skills/szmc-interesting-cases.md` | Emit case-conference summary | Turn 2 for note type 4 |
| `hebrew-medical-glossary` | `public/skills/hebrew-medical-glossary.md` | All Hebrew terminology + bidi guidance | every turn (always) |
| `audit-fix-deploy` | *not bundled* | Dev-side CI + Claude Code slash command | — |

Skills are copied from your maintained skill sources at build time (a `scripts/sync-skills.mjs` step in `prebuild`), so the app always ships the current versions and skill upgrades don't require a code change in ward-helper itself.

---

## 12. Open questions / v2 roadmap

- Voice dictation (Web Speech API, Hebrew) — post-v1
- Team / rounds-handoff mode (would require real Supabase auth + PHI re-review)
- Native iOS/Android wrapper (Capacitor) — only if PWA install proves painful in practice
- Integration with Toranot patient list (read-only bridge, not shared storage)
- Push notifications for follow-up reminders on saved patients

---

## 13. Success criteria for v1 ship

1. Full rounds workflow (capture → review → edit → copy → paste into Chameleon) takes < 90 seconds per note on a modern iPhone
2. Extraction eval harness ≥ 95% on critical fields
3. Zero plaintext PHI ever reaches Supabase (verified by unit test + manual inspection of a synthetic account)
4. Bidi linter passes on every generated note across 20+ diverse test cases
5. Bundle size ≤ 150 kB gzipped main chunk
6. Installable PWA on iOS Safari + Android Chrome
7. `audit-fix-deploy` pipeline green on `main`
