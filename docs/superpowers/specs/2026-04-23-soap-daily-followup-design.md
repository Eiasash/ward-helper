# SOAP daily follow-up — Design

**Date:** 2026-04-23
**Status:** Approved for planning
**Builds on:** v1.0.0 — adds a 5th note type to the existing Capture → Review → Edit pipeline.

---

## 1. Goal

Add `SOAP יומי` — the daily progress note — as a 5th note type with built-in clinical continuity. When a patient has a prior record in device-local history, the app loads the most recent admission note and SOAPs as emit-turn context, so today's note reads as *change since yesterday* rather than a re-scan of the chart.

Output follows the SZMC Hebrew ward convention: short, problem-oriented, with per-system hashtag headers in the Assessment (e.g. `#הימודינמי`, `#כלייתי`, `#זיהומי`).

## 2. Non-goals (v1 of this feature)

- Multi-admission history (if the same patient has two separate admissions 3 months apart, only the most recent 30-day window counts — earlier admissions are ignored for continuity)
- Cross-device continuity (Supabase backup is ciphertext; continuity runs on device-local IDB only)
- Auto-scheduled SOAP reminders, push notifications, or calendar-based nudges
- Problem-level timeline visualization across multiple SOAPs

## 3. Routing model

**Option C from brainstorming** — both entry paths:

- **Fresh capture**: Capture screen → tap new `SOAP יומי` tab → snap AZMA → if extracted ת.ז. matches a device-local patient within 30 days, the Review screen shows a *continuity banner* with a default-ON toggle to use prior records as emit context. If no match, the flow is identical to a fresh admission/consult note.
- **History shortcut**: on any patient card in History, a `+ SOAP היום` button pre-seeds `sessionStorage.noteType = 'soap'` and `sessionStorage.continuityPatientId = <id>`, then routes to `/` so the user just snaps today's AZMA. Continuity is implicit and banner-confirmed in Review.

## 4. Continuity resolver

A new pure module `src/notes/continuity.ts` with a single entry point:

```ts
export interface ContinuityContext {
  patient: Patient | null;
  admission: Note | null;       // most recent type='admission' for this teudatZehut
  priorSoaps: Note[];           // all type='soap' for this teudatZehut, newest-first
  mostRecentSoap: Note | null;  // priorSoaps[0] ?? null
  episodeStart: number | null;  // admission.createdAt, or earliest note if no admission
}

export async function resolveContinuity(teudatZehut: string): Promise<ContinuityContext>;
```

Resolution rules:

1. Match patients by **exact `teudatZehut` string equality**. Trim whitespace. No fuzzy matching.
2. For each matched patient, load all notes and filter by type.
3. **30-day episode window**: if `now - admission.createdAt > 30 * 86_400_000`, treat as "no continuity" (older episode, stale). Show `patient` but clear `admission` and `priorSoaps`. This prevents accidentally pulling a patient's admission from 6 months ago as today's anchor.
4. If multiple matches on ת.ז. (e.g., data-entry duplicate), return the patient whose `updatedAt` is most recent.

Pure function; no side effects; testable with IDB fixtures.

## 5. Review screen — continuity banner

When `noteType === 'soap'` and `context.patient !== null`:

```
┌──────────────────────────────────────────────────────┐
│ ☷ מטופל דוד לוי (ת.ז. 012345678)                     │
│   • קבלה מ-20.4 · Pneumonia + AKI                    │
│   • 2 SOAPs קודמים (אחרון: אתמול 22.4)               │
│                                                      │
│   [ ✓ השתמש כרקע ]   (default ON)                    │
└──────────────────────────────────────────────────────┘
```

- Banner renders above the existing FieldRows.
- Toggle default: `true` when `admission` or `priorSoaps.length > 0`; `false` otherwise.
- State stored in `sessionStorage.soapContinuity` as `"on" | "off"`.
- If user turns OFF, the emit turn runs as a "fresh" SOAP (no context loaded into prompt).
- Banner is informational only — it does not override or skip the critical-field gate.

## 6. Emit prompt differentiation

`generateNote()` in `src/notes/orchestrate.ts` takes an extra optional `continuity: ContinuityContext | null` argument and builds three different emit prompts:

### Case 1 — Fresh SOAP, no prior

No continuity toggle ON, or no match. Emit prompt:

> Emit a SOAP note in Hebrew. First SOAP for this patient — anchor the Assessment one-liner from today's chief complaint + PMH + age/sex. Keep it short (2–4 sentences in S, 4–6 objective findings in O, hashtag-category bullets in A, numbered plan in P). Use per-system categories in Assessment: `#הימודינמי`, `#נשימתי`, `#זיהומי`, `#כלייתי`, `#נוירולוגי`, `#מטבולי`, `#המטולוגי`, `#גריאטרי` — include only categories relevant to this patient. One line per category.

### Case 2 — First SOAP post-admission (admission exists, no prior SOAPs)

Emit prompt prepends:

> Context: admission note from DD.MM.YY follows. Use it to anchor the Assessment one-liner ("82yo male admitted DD.MM.YY for pneumonia with PMH of HTN, DM"), and to populate the hashtag categories with the active problems from admission. Do not restate the full admission — just the one-liner + active problems.
>
> ---
> {admission.bodyHebrew}
> ---

Then same SOAP structure as Case 1.

### Case 3 — Follow-up SOAP (prior SOAPs exist)

Emit prompt prepends:

> Context: admission one-liner + most recent prior SOAP from DD.MM.YY follow. Preserve the admission anchor. For each `#hashtag` category from the prior SOAP, track the trajectory vs today:
> - Same → short "ללא שינוי משמעותי"
> - Changed → show the delta (e.g. `Cr: 2.1 → 1.8 ↓`, `Apixaban הופסק`, `חום 39.2 → afebrile`)
> - Resolved → mark "נפתר" and remove from next SOAP's active list
> - New → add under the right category
>
> ---
> ADMISSION (DD.MM.YY):
> {admission.bodyHebrew}
>
> MOST RECENT SOAP (DD.MM.YY):
> {mostRecentSoap.bodyHebrew}
> ---

Same SOAP structure. Plan section should be short: bullets per active problem, nothing aspirational beyond 24h.

### Shared output style (all three cases)

Style constraints in every SOAP emit prompt:

- **Short and sweet**: target total length 200–400 Hebrew words
- **S**: 1–3 sentences, overnight complaints or "ללא תלונות" if none
- **O**: structured block — Vitals | Exam highlights | Labs (trend arrows where applicable) | Imaging if new
- **A**: hashtag categories only, one line each. Example: `#כלייתי: AKI, Cr 1.8 (↓ מ-2.1), שתן 40 ml/h`
- **P**: numbered 1., 2., 3. — short imperative
- Bidi: drug names / lab abbreviations stay English; trend arrows `→ ↑ ↓` are neutral Unicode; hashtag labels are Hebrew

## 7. Note type + label

Add to `src/notes/templates.ts`:

```ts
soap: 'SOAP יומי'
```

Skill map:

```ts
soap: ['szmc-clinical-notes', 'hebrew-medical-glossary']
```

The szmc-clinical-notes skill already covers SOAP convention. The emit prompt does the case-specific structuring; the skill provides the institutional voice.

## 8. Schema

- `NoteType` enum extended: `'admission' | 'discharge' | 'consult' | 'case' | 'soap'`.
- Existing IDB rows remain valid (they all use the original 4 values). No migration needed.
- `Note.structuredData` for SOAPs includes the same `ParseFields` shape as other types — no new fields required. Continuity context is computed on demand from IDB, not persisted inside the note.

## 9. Module changes

| File | Change |
|---|---|
| `src/notes/continuity.ts` | **new** — `resolveContinuity(teudatZehut)` |
| `src/notes/templates.ts` | add `soap` to `NOTE_LABEL` + `NOTE_SKILL_MAP` |
| `src/notes/orchestrate.ts` | `generateNote` now accepts optional `continuity` arg; builds per-case emit prompt |
| `src/storage/indexed.ts` | extend `NoteType` type; add `listNotesByTeudatZehut(tz: string)` helper |
| `src/ui/screens/Capture.tsx` | add 5th `SOAP יומי` tab; pre-seed from `sessionStorage.continuityPatientId` if present |
| `src/ui/screens/Review.tsx` | render `ContinuityBanner` above fields when SOAP + match |
| `src/ui/components/ContinuityBanner.tsx` | **new** |
| `src/ui/screens/History.tsx` | add `+ SOAP היום` button on each patient card |
| `src/ui/screens/NoteEditor.tsx` | read continuity context from sessionStorage, pass to `generateNote` |
| `tests/continuity.test.ts` | **new** — 30-day window, no-match, one-match, multi-match-by-updatedAt |
| `tests/bidi.test.ts` | add SOAP fixture with trend arrows + hashtags |
| `tests/notes.test.ts` (if absent, add) | `generateNote` prompt-shape per case |

## 10. Testing plan

Target: **+8 new tests** (22 → 30).

- `continuity.test.ts` — 4 tests (no patient, one patient + admission, one patient + prior SOAPs, 30-day-stale episode)
- `bidi.test.ts` — 2 added (trend arrows preserved through wrapForChameleon, hashtag labels not wrapped with LRM)
- `notes.test.ts` — 2 (prompt includes admission block when Case 2; prompt includes both admission + prior SOAP when Case 3)

## 11. Out-of-scope / v2 roadmap

- SOAP-to-SOAP diff visualization in History (show deltas at a glance)
- Problem-list object persisted across SOAPs so resolved items drop out automatically without re-prompting Claude
- Rounds-mode: batch multiple patients' SOAPs sequentially
- Voice-dictated S section (Hebrew STT)
- Templates for specific rotations (e.g. geriatrics, palliative) that pre-seed additional categories

## 12. Ship criteria

1. "SOAP יומי" tab on Capture, behaves identically to the other 4 for a fresh patient
2. Auto-match on ת.ז. → continuity banner appears on Review, toggle-able
3. First SOAP post-admission uses admission note as context; output contains the "admitted DD.MM.YY for X" one-liner
4. Follow-up SOAP shows trajectory deltas — verified on a real 2-day sequence manually
5. Output uses hashtag-category Assessment (`#הימודינמי` etc.), only relevant categories present
6. All ship invariants still hold (bundle ≤ 150 kB gzipped, CSP, no analytics, PBKDF2 600k)
7. 30 tests passing (22 current + 8 new)
