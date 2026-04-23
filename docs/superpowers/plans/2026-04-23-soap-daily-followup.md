# SOAP daily follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th note type `soap` to ward-helper with device-local continuity — when a patient's teudat zehut matches an existing record within 30 days, load admission + prior SOAPs into the emit prompt so the note reads as *change since yesterday* with hashtag-category Assessment (`#הימודינמי`, `#כלייתי`, etc.).

**Architecture:** Extend `NoteType` enum, add pure continuity resolver that reads from existing IndexedDB, thread a `ContinuityContext` object through Review → NoteEditor → orchestrate. No new storage, no migration. Emit prompt branches into three cases (fresh / first-post-admission / follow-up-with-prior) inside the existing 2-turn agent loop.

**Tech stack:** Same as v1 — React 18 + TS 5 + Vite + Vitest + idb. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-04-23-soap-daily-followup-design.md`

---

## File structure

```
src/
├── notes/
│   ├── continuity.ts         ← NEW — resolveContinuity(teudatZehut)
│   ├── orchestrate.ts        ← MODIFY — generateNote(noteType, parsed, continuity?)
│   └── templates.ts          ← MODIFY — add 'soap' to NOTE_LABEL + NOTE_SKILL_MAP
├── storage/
│   └── indexed.ts            ← MODIFY — extend NoteType, add listNotesByTeudatZehut
└── ui/
    ├── components/
    │   └── ContinuityBanner.tsx  ← NEW
    └── screens/
        ├── Capture.tsx       ← MODIFY — 5th tab; read continuityPatientId from sessionStorage
        ├── Review.tsx        ← MODIFY — render ContinuityBanner for SOAP; resolve context
        ├── NoteEditor.tsx    ← MODIFY — thread continuity into generateNote
        └── History.tsx       ← MODIFY — + SOAP היום button per patient card
tests/
├── continuity.test.ts        ← NEW — 4 tests
├── bidi.test.ts              ← MODIFY — +2 tests (arrows, hashtags)
└── notes.test.ts             ← NEW — 2 tests (prompt-shape per case)
```

---

## Task 1: Extend NoteType + add `listNotesByTeudatZehut` helper

**Files:**
- Modify: `src/storage/indexed.ts`
- Test: `tests/storage.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/storage.test.ts` at end (before last closing line if any):

```ts
describe('listNotesByTeudatZehut', () => {
  it('returns notes for patients matching the given teudat zehut', async () => {
    const tz = '098765432';
    const pA: Patient = { id: 'pA', name: 'A', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 2 };
    const pB: Patient = { id: 'pB', name: 'B', teudatZehut: '111111111', dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 };
    await putPatient(pA); await putPatient(pB);
    await putNote({ id: 'n1', patientId: 'pA', type: 'admission', bodyHebrew: 'קבלה', structuredData: {}, createdAt: 10, updatedAt: 10 });
    await putNote({ id: 'n2', patientId: 'pA', type: 'soap',      bodyHebrew: 'SOAP',  structuredData: {}, createdAt: 20, updatedAt: 20 });
    await putNote({ id: 'n3', patientId: 'pB', type: 'soap',      bodyHebrew: 'ignore',structuredData: {}, createdAt: 30, updatedAt: 30 });

    const out = await listNotesByTeudatZehut(tz);
    expect(out.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(out.patient?.id).toBe('pA');
  });

  it('trims whitespace on the teudat zehut input', async () => {
    const tz = '012345678';
    await putPatient({ id: 'p1', name: 'X', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 1 });
    const out = await listNotesByTeudatZehut('  ' + tz + '  ');
    expect(out.patient?.id).toBe('p1');
  });

  it('returns null patient + empty notes on no match', async () => {
    const out = await listNotesByTeudatZehut('000000000');
    expect(out.patient).toBeNull();
    expect(out.notes).toEqual([]);
  });

  it('on duplicate teudat zehut picks the most recently updated patient', async () => {
    const tz = '222222222';
    await putPatient({ id: 'old', name: 'X', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 10 });
    await putPatient({ id: 'new', name: 'Y', teudatZehut: tz, dob: '', room: null, tags: [], createdAt: 1, updatedAt: 50 });
    const out = await listNotesByTeudatZehut(tz);
    expect(out.patient?.id).toBe('new');
  });
});
```

Ensure `listNotesByTeudatZehut` is added to the existing import block at the top.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /e/Downloads/ward-helper && npm test
```

Expected: `listNotesByTeudatZehut is not a function`.

- [ ] **Step 3: Extend NoteType + implement helper**

In `src/storage/indexed.ts`, update the `NoteType` line:

```ts
export type NoteType = 'admission' | 'discharge' | 'consult' | 'case' | 'soap';
```

Append at the end of the file (after `getSettings`):

```ts
export async function listNotesByTeudatZehut(
  teudatZehut: string,
): Promise<{ patient: Patient | null; notes: Note[] }> {
  const tz = teudatZehut.trim();
  if (!tz) return { patient: null, notes: [] };
  const db = await getDb();
  const all = (await db.getAll('patients')) as Patient[];
  const matches = all.filter((p) => p.teudatZehut === tz);
  if (matches.length === 0) return { patient: null, notes: [] };
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  const patient = matches[0]!;
  const notesByPatient = await Promise.all(
    matches.map((p) => db.getAllFromIndex('notes', 'by-patient', p.id)),
  );
  const notes = notesByPatient.flat() as Note[];
  return { patient, notes };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test
```

Expected: 26 tests passing (22 existing + 4 new). `tsc --noEmit` also clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): extend NoteType to include 'soap' + listNotesByTeudatZehut helper"
```

---

## Task 2: Continuity resolver (pure module, TDD)

**Files:**
- Create: `src/notes/continuity.ts`
- Create: `tests/continuity.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/continuity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { putPatient, putNote, resetDbForTests, type Patient, type Note } from '@/storage/indexed';
import { resolveContinuity, EPISODE_WINDOW_MS } from '@/notes/continuity';

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

function mkPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: crypto.randomUUID(),
    name: 'דוד לוי',
    teudatZehut: '012345678',
    dob: '1944-03-01',
    room: '3-12',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function mkNote(overrides: Partial<Note>): Note {
  return {
    id: crypto.randomUUID(),
    patientId: 'x',
    type: 'admission',
    bodyHebrew: '',
    structuredData: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('resolveContinuity', () => {
  it('returns null patient + empty everything when no match', async () => {
    const ctx = await resolveContinuity('999999999');
    expect(ctx.patient).toBeNull();
    expect(ctx.admission).toBeNull();
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.mostRecentSoap).toBeNull();
    expect(ctx.episodeStart).toBeNull();
  });

  it('loads admission + no prior SOAPs when patient just admitted', async () => {
    const p = mkPatient();
    await putPatient(p);
    const adm = mkNote({ patientId: p.id, type: 'admission', bodyHebrew: 'קבלה רפואית...', createdAt: Date.now() - 86_400_000 });
    await putNote(adm);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.patient?.id).toBe(p.id);
    expect(ctx.admission?.id).toBe(adm.id);
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.mostRecentSoap).toBeNull();
    expect(ctx.episodeStart).toBe(adm.createdAt);
  });

  it('loads admission + prior SOAPs newest-first for follow-up', async () => {
    const p = mkPatient();
    await putPatient(p);
    const now = Date.now();
    const adm = mkNote({ patientId: p.id, type: 'admission', createdAt: now - 3 * 86_400_000 });
    const s1 = mkNote({ patientId: p.id, type: 'soap', bodyHebrew: 'day 1', createdAt: now - 2 * 86_400_000 });
    const s2 = mkNote({ patientId: p.id, type: 'soap', bodyHebrew: 'day 2', createdAt: now - 1 * 86_400_000 });
    await putNote(adm); await putNote(s1); await putNote(s2);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.admission?.id).toBe(adm.id);
    expect(ctx.priorSoaps.map((n) => n.id)).toEqual([s2.id, s1.id]);
    expect(ctx.mostRecentSoap?.id).toBe(s2.id);
  });

  it('treats episodes older than 30 days as stale — clears admission + priorSoaps', async () => {
    const p = mkPatient();
    await putPatient(p);
    const old = Date.now() - (EPISODE_WINDOW_MS + 86_400_000);
    const adm = mkNote({ patientId: p.id, type: 'admission', createdAt: old });
    const soap = mkNote({ patientId: p.id, type: 'soap', createdAt: old + 3600_000 });
    await putNote(adm); await putNote(soap);
    const ctx = await resolveContinuity(p.teudatZehut);
    expect(ctx.patient?.id).toBe(p.id);
    expect(ctx.admission).toBeNull();
    expect(ctx.priorSoaps).toEqual([]);
    expect(ctx.episodeStart).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test tests/continuity.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `src/notes/continuity.ts`**

```ts
import {
  listNotesByTeudatZehut,
  type Note,
  type Patient,
} from '@/storage/indexed';

export const EPISODE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ContinuityContext {
  patient: Patient | null;
  admission: Note | null;
  priorSoaps: Note[];
  mostRecentSoap: Note | null;
  episodeStart: number | null;
}

export async function resolveContinuity(teudatZehut: string): Promise<ContinuityContext> {
  const empty: ContinuityContext = {
    patient: null,
    admission: null,
    priorSoaps: [],
    mostRecentSoap: null,
    episodeStart: null,
  };

  const { patient, notes } = await listNotesByTeudatZehut(teudatZehut);
  if (!patient) return empty;

  const admissions = notes
    .filter((n) => n.type === 'admission')
    .sort((a, b) => b.createdAt - a.createdAt);
  const admission = admissions[0] ?? null;

  const soaps = notes
    .filter((n) => n.type === 'soap')
    .sort((a, b) => b.createdAt - a.createdAt);

  const episodeStart = admission?.createdAt ?? null;
  const stale = episodeStart !== null && Date.now() - episodeStart > EPISODE_WINDOW_MS;

  if (stale) {
    return { ...empty, patient };
  }

  return {
    patient,
    admission,
    priorSoaps: soaps,
    mostRecentSoap: soaps[0] ?? null,
    episodeStart,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test tests/continuity.test.ts
npm run check
```

Expected: 4 continuity tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notes): continuity resolver with 30-day episode window"
```

---

## Task 3: Templates — add `soap` label + skill map

**Files:**
- Modify: `src/notes/templates.ts`

- [ ] **Step 1: Edit the file**

Replace the full contents of `src/notes/templates.ts`:

```ts
import type { NoteType } from '@/storage/indexed';
import type { SkillName } from '@/skills/loader';

export const NOTE_SKILL_MAP: Record<NoteType, [SkillName, SkillName]> = {
  admission: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  discharge: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  consult: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
  case: ['szmc-interesting-cases', 'hebrew-medical-glossary'],
  soap: ['szmc-clinical-notes', 'hebrew-medical-glossary'],
};

export const NOTE_LABEL: Record<NoteType, string> = {
  admission: 'קבלה',
  discharge: 'שחרור',
  consult: 'ייעוץ',
  case: 'מקרה מעניין',
  soap: 'SOAP יומי',
};
```

- [ ] **Step 2: Type check**

```bash
npm run check
```

Expected: clean. (TS will force us to update every switch/lookup over `NoteType` in the rest of the codebase — if any error appears, that indicates a missing case somewhere. Record the list; you'll fix them in Tasks 4–8.)

- [ ] **Step 3: Commit**

```bash
git add src/notes/templates.ts
git commit -m "feat(notes): add 'soap' to NOTE_LABEL + NOTE_SKILL_MAP"
```

---

## Task 4: Orchestrator — per-case emit prompts

**Files:**
- Modify: `src/notes/orchestrate.ts`
- Create: `tests/notes.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/notes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSoapPromptPrefix } from '@/notes/orchestrate';
import type { ContinuityContext } from '@/notes/continuity';
import type { Note } from '@/storage/indexed';

function mkNote(overrides: Partial<Note>): Note {
  return {
    id: 'n', patientId: 'p', type: 'admission', bodyHebrew: '',
    structuredData: {}, createdAt: 0, updatedAt: 0, ...overrides,
  };
}

describe('buildSoapPromptPrefix', () => {
  it('case 1 (fresh): returns first-SOAP instructions, no admission block', () => {
    const ctx: ContinuityContext = {
      patient: null, admission: null, priorSoaps: [],
      mostRecentSoap: null, episodeStart: null,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('First SOAP for this patient');
    expect(out).not.toContain('ADMISSION');
    expect(out).not.toContain('MOST RECENT SOAP');
  });

  it('case 2 (first post-admission): includes admission block + anchor instruction', () => {
    const adm = mkNote({ type: 'admission', bodyHebrew: 'קבלה: 82yo male admitted for pneumonia', createdAt: Date.parse('2026-04-20') });
    const ctx: ContinuityContext = {
      patient: { id: 'p', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 0, updatedAt: 0 },
      admission: adm, priorSoaps: [], mostRecentSoap: null, episodeStart: adm.createdAt,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('admission note');
    expect(out).toContain('82yo male admitted for pneumonia');
    expect(out).not.toContain('MOST RECENT SOAP');
  });

  it('case 3 (follow-up): includes both admission + most-recent SOAP', () => {
    const adm = mkNote({ type: 'admission', bodyHebrew: 'קבלה body', createdAt: 1 });
    const prior = mkNote({ type: 'soap', bodyHebrew: 'yesterday SOAP body', createdAt: 2 });
    const ctx: ContinuityContext = {
      patient: { id: 'p', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 0, updatedAt: 0 },
      admission: adm, priorSoaps: [prior], mostRecentSoap: prior, episodeStart: adm.createdAt,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('ADMISSION');
    expect(out).toContain('MOST RECENT SOAP');
    expect(out).toContain('yesterday SOAP body');
    expect(out).toContain('trajectory vs today');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test tests/notes.test.ts
```

Expected: `buildSoapPromptPrefix is not exported`.

- [ ] **Step 3: Rewrite `src/notes/orchestrate.ts`**

Replace the full contents:

```ts
import { getClient } from '@/agent/client';
import { runEmitTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { wrapForChameleon } from '@/i18n/bidi';
import { NOTE_SKILL_MAP } from './templates';
import type { ParseResult } from '@/agent/tools';
import type { NoteType } from '@/storage/indexed';
import type { ContinuityContext } from './continuity';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const SHARED_SOAP_STYLE = `
Output style (mandatory):
- Short and sweet — 200–400 Hebrew words total
- S: 1–3 sentences of overnight complaints, or "ללא תלונות" if none
- O: structured — Vitals | Exam | Labs (with trend arrows → ↑ ↓ where applicable) | Imaging if new
- A: per-system hashtag categories only, one short line each. Include only categories relevant to this patient. Canonical set: #הימודינמי #נשימתי #זיהומי #כלייתי #נוירולוגי #מטבולי #המטולוגי #גריאטרי
- P: numbered 1., 2., 3. — short imperative, 24-hour horizon only
- Bidi: drug + lab abbreviations stay English; trend arrows (→ ↑ ↓) are neutral Unicode; hashtag labels are Hebrew.
`.trim();

export function buildSoapPromptPrefix(continuity: ContinuityContext | null): string {
  if (!continuity || (!continuity.admission && continuity.priorSoaps.length === 0)) {
    return [
      'Emit a SOAP note in Hebrew.',
      'First SOAP for this patient — anchor the Assessment one-liner from today\'s chief complaint + PMH + age/sex.',
      SHARED_SOAP_STYLE,
    ].join('\n\n');
  }

  const admBlock = continuity.admission
    ? `ADMISSION (${fmtDate(continuity.admission.createdAt)}):\n${continuity.admission.bodyHebrew}`
    : '';

  if (continuity.mostRecentSoap) {
    const soapBlock = `MOST RECENT SOAP (${fmtDate(continuity.mostRecentSoap.createdAt)}):\n${continuity.mostRecentSoap.bodyHebrew}`;
    return [
      'Emit a SOAP note in Hebrew — follow-up for an existing admission episode.',
      'Context below. Preserve the admission one-liner. For each #hashtag category from the prior SOAP, track the trajectory vs today:',
      '- Same → "ללא שינוי משמעותי"',
      '- Changed → show the delta (e.g. Cr: 2.1 → 1.8 ↓, Apixaban הופסק, חום 39.2 → afebrile)',
      '- Resolved → mark "נפתר"',
      '- New → add under the right category',
      '',
      '---',
      admBlock,
      '',
      soapBlock,
      '---',
      '',
      SHARED_SOAP_STYLE,
    ].join('\n');
  }

  return [
    'Emit a SOAP note in Hebrew — this is the first SOAP for an existing admission.',
    'Use the admission note below to anchor the Assessment one-liner in the format: "<age>yo <sex>, admitted <date> for <diagnosis>, PMH of <PMH>". Populate hashtag categories from admission\'s active problems. Do not restate the full admission — only the one-liner + active problems.',
    '',
    '---',
    admBlock,
    '---',
    '',
    SHARED_SOAP_STYLE,
  ].join('\n');
}

export async function generateNote(
  noteType: NoteType,
  validated: ParseResult,
  continuity: ContinuityContext | null = null,
): Promise<string> {
  const client = await getClient();
  const skills = NOTE_SKILL_MAP[noteType];
  const skillContent = await loadSkills([...skills]);

  const prefix = noteType === 'soap' ? buildSoapPromptPrefix(continuity) : '';
  const systemWithPrefix = prefix ? `${skillContent}\n\n---\n\n${prefix}` : skillContent;

  const raw = await runEmitTurn(client, noteType, validated, systemWithPrefix);
  return wrapForChameleon(raw);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test
npm run check
```

Expected: 3 new prompt-shape tests pass + 26 previous still green = 29 total.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(notes): per-case emit prompt for SOAP (fresh/first-post-admission/follow-up)"
```

---

## Task 5: Capture screen — 5th tab + continuityPatientId pre-seeding

**Files:**
- Modify: `src/ui/screens/Capture.tsx`

- [ ] **Step 1: Replace the NOTE_TYPES list and add preseed effect**

In `src/ui/screens/Capture.tsx`, extend `NOTE_TYPES`:

```ts
const NOTE_TYPES: { type: NoteType; label: string }[] = [
  { type: 'admission', label: 'קבלה' },
  { type: 'discharge', label: 'שחרור' },
  { type: 'consult', label: 'ייעוץ' },
  { type: 'case', label: 'מקרה מעניין' },
  { type: 'soap', label: 'SOAP יומי' },
];
```

Add an effect at the top of the `Capture()` component body (after `const fileRef = useRef<HTMLInputElement>(null);`):

```tsx
import { useEffect } from 'react';
// ...
useEffect(() => {
  const seeded = sessionStorage.getItem('continuityNoteType');
  if (seeded === 'soap') {
    setNoteType('soap');
    sessionStorage.removeItem('continuityNoteType');
  }
}, []);
```

(The import of `useEffect` — make sure it's already imported at the top of the file. If not, add it.)

- [ ] **Step 2: Type check + visual sanity**

```bash
npm run check
npm run dev  # optional — verify 5 tabs render + SOAP tab is selectable
```

Expected: clean tsc.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/Capture.tsx
git commit -m "feat(capture): SOAP יומי tab + continuityNoteType preseed from History shortcut"
```

---

## Task 6: ContinuityBanner + Review screen wiring

**Files:**
- Create: `src/ui/components/ContinuityBanner.tsx`
- Modify: `src/ui/screens/Review.tsx`

- [ ] **Step 1: Implement ContinuityBanner**

`src/ui/components/ContinuityBanner.tsx`:

```tsx
import type { ContinuityContext } from '@/notes/continuity';

interface Props {
  ctx: ContinuityContext;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function ContinuityBanner({ ctx, enabled, onToggle }: Props) {
  if (!ctx.patient) return null;

  const admissionLine = ctx.admission
    ? `• קבלה מ-${fmt(ctx.admission.createdAt)}`
    : null;
  const soapLine = ctx.priorSoaps.length > 0
    ? `• ${ctx.priorSoaps.length} SOAP קודמים (אחרון: ${fmt(ctx.mostRecentSoap!.createdAt)})`
    : null;

  // If both are empty (stale episode), hide the banner entirely
  if (!admissionLine && !soapLine) return null;

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--accent)',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        ☷ מטופל <strong>{ctx.patient.name}</strong> (ת.ז. {ctx.patient.teudatZehut})
      </div>
      {admissionLine && <div style={{ color: 'var(--muted)', fontSize: 14 }}>{admissionLine}</div>}
      {soapLine && <div style={{ color: 'var(--muted)', fontSize: 14 }}>{soapLine}</div>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        השתמש כרקע ל-SOAP של היום
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Wire Review.tsx**

Modify `src/ui/screens/Review.tsx`:

Imports to add:

```ts
import { resolveContinuity, type ContinuityContext } from '@/notes/continuity';
import { ContinuityBanner } from '../components/ContinuityBanner';
```

In the component, add state + effect after the existing `useEffect`:

```tsx
const [continuity, setContinuity] = useState<ContinuityContext | null>(null);
const [continuityEnabled, setContinuityEnabled] = useState<boolean>(true);

useEffect(() => {
  (async () => {
    const noteType = sessionStorage.getItem('noteType');
    if (noteType !== 'soap') return;
    const tz = fields.teudatZehut?.trim();
    if (!tz) return;
    const ctx = await resolveContinuity(tz);
    setContinuity(ctx);
    const stored = sessionStorage.getItem('soapContinuity');
    const hasAnyContext = !!(ctx.admission || ctx.priorSoaps.length > 0);
    setContinuityEnabled(stored === 'off' ? false : hasAnyContext);
  })();
}, [fields.teudatZehut]);

function onToggleContinuity(v: boolean) {
  setContinuityEnabled(v);
  sessionStorage.setItem('soapContinuity', v ? 'on' : 'off');
}
```

Render the banner in the existing JSX, right after `<h1>בדיקה</h1>`:

```tsx
{continuity && sessionStorage.getItem('noteType') === 'soap' && (
  <ContinuityBanner
    ctx={continuity}
    enabled={continuityEnabled}
    onToggle={onToggleContinuity}
  />
)}
```

Also update `onProceed` at the bottom of the component — instead of only storing `validated`, stamp the resolved continuity intent:

```tsx
function onProceed() {
  sessionStorage.setItem('validated', JSON.stringify(fields));
  if (sessionStorage.getItem('noteType') === 'soap' && continuity?.patient && continuityEnabled) {
    sessionStorage.setItem('continuityTeudatZehut', continuity.patient.teudatZehut);
  } else {
    sessionStorage.removeItem('continuityTeudatZehut');
  }
  nav('/edit');
}
```

- [ ] **Step 3: Type check**

```bash
npm run check
npm test
```

Expected: clean tsc; 29 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): ContinuityBanner + Review-screen wiring for SOAP"
```

---

## Task 7: NoteEditor — thread continuity into generateNote

**Files:**
- Modify: `src/ui/screens/NoteEditor.tsx`

- [ ] **Step 1: Edit**

At the top of `src/ui/screens/NoteEditor.tsx`, add import:

```ts
import { resolveContinuity } from '@/notes/continuity';
```

In the body of the first `useEffect`, change the `generateNote` call. Current code:

```tsx
const text = await generateNote(nt, {
  fields: validated,
  confidence: {},
  sourceRegions: {},
});
```

Replace with:

```tsx
const continuityTz = sessionStorage.getItem('continuityTeudatZehut');
const continuity = continuityTz ? await resolveContinuity(continuityTz) : null;
const text = await generateNote(
  nt,
  { fields: validated, confidence: {}, sourceRegions: {} },
  continuity,
);
```

- [ ] **Step 2: Type check**

```bash
npm run check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/NoteEditor.tsx
git commit -m "feat(notes): thread continuity context into NoteEditor → generateNote"
```

---

## Task 8: History — `+ SOAP היום` per-patient shortcut

**Files:**
- Modify: `src/ui/screens/History.tsx`

- [ ] **Step 1: Edit**

Add a small handler + button inside the patient card in `src/ui/screens/History.tsx`. Add these imports:

```ts
import { useNavigate } from 'react-router-dom';
```

Inside the component, add:

```tsx
const nav = useNavigate();

function startSoapForPatient(tz: string) {
  sessionStorage.setItem('continuityNoteType', 'soap');
  sessionStorage.setItem('noteType', 'soap');
  // We don't pre-extract; user still snaps AZMA. Continuity will resolve on Review.
  // continuityTeudatZehut gets set on Review onProceed if the banner stays on.
  nav('/');
}
```

In the JSX for each patient card, at the bottom (after the note badges), add:

```tsx
<button
  className="ghost"
  style={{ marginTop: 8, fontSize: 13 }}
  onClick={() => startSoapForPatient(p.teudatZehut)}
>
  + SOAP היום
</button>
```

- [ ] **Step 2: Type check + visual sanity**

```bash
npm run check
npm run dev  # optional — verify button appears; tapping routes to / with SOAP tab auto-selected
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/History.tsx
git commit -m "feat(history): '+ SOAP היום' shortcut per patient card"
```

---

## Task 9: Bidi tests — trend arrows + hashtag labels

**Files:**
- Modify: `tests/bidi.test.ts`

- [ ] **Step 1: Append two tests**

```ts
describe('bidi with SOAP-style content', () => {
  it('preserves trend arrows unchanged', () => {
    const input = 'Cr: 2.1 → 1.8, BNP 1200 → 800 ↓';
    const out = wrapForChameleon(input);
    expect(out).toContain('→');
    expect(out).toContain('↓');
  });

  it('does not wrap Hebrew hashtag labels with LRM', () => {
    const input = '#הימודינמי: יציב, #כלייתי: AKI';
    const out = wrapForChameleon(input);
    // Hashtag + Hebrew text should remain unchanged — no LRM injected
    expect(out).toBe(input);
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test tests/bidi.test.ts
```

Expected: 2 new tests pass (8 total in that file), global 31 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/bidi.test.ts
git commit -m "test(bidi): SOAP trend arrows + hashtag-label preservation"
```

---

## Task 10: Build + ship v1.1.0

**Files:** none new

- [ ] **Step 1: Full verify**

```bash
cd /e/Downloads/ward-helper
npm run check
npm test
npm run build
```

Expected:
- tsc clean
- 31 tests passing (22 + 4 + 4 + 3 - 2 overlap if any + 2)
- Build produces `dist/assets/index-*.js` at ≤ 150 kB gzipped (should still be ~130 kB — we added ~300 lines of pure logic, mostly prompts).

- [ ] **Step 2: Update package.json version**

Edit `package.json`:

```json
"version": "1.1.0",
```

- [ ] **Step 3: Commit version bump + push**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 1.1.0 (SOAP daily follow-up)"
git push origin main
```

- [ ] **Step 4: Wait for CI + Pages green**

```bash
gh run list --repo Eiasash/ward-helper --limit 3
gh run watch --repo Eiasash/ward-helper $(gh run list --repo Eiasash/ward-helper --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: CI + Deploy to GitHub Pages both ✓.

- [ ] **Step 5: Tag + release**

```bash
git tag v1.1.0
git push origin v1.1.0
gh release create v1.1.0 --repo Eiasash/ward-helper --title "ward-helper v1.1.0 — SOAP daily follow-up" --notes "## What's new

- 5th note type: **SOAP יומי** (daily progress note)
- Device-local continuity: auto-match on ת.ז. within 30-day window
- Continuity banner on Review with default-ON toggle
- Three emit prompts based on context (fresh / first-post-admission / follow-up-with-prior)
- SZMC hashtag-category Assessment: #הימודינמי / #נשימתי / #זיהומי / #כלייתי / #נוירולוגי / #מטבולי / #המטולוגי / #גריאטרי — only relevant categories per patient
- Trajectory deltas vs yesterday for follow-up SOAPs (labs, meds, problem status)
- \`+ SOAP היום\` shortcut from patient cards in History

## Invariants held
- Bundle ≤ 150 kB gzipped, CSP + no-analytics + PBKDF2-600k + dangerouslyAllowBrowser checks still pass
- 31 tests passing (was 22)
- No IDB migration — NoteType enum extended backward-compatibly
- No plaintext PHI in cloud; continuity runs entirely on device-local IndexedDB

## Live
https://eiasash.github.io/ward-helper/"
```

- [ ] **Step 6: Smoke-check the live URL**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://eiasash.github.io/ward-helper/
```

Expected: 200.

---

## Self-review

**Spec coverage — every section has a task:**
- §1 goal → Tasks 1-10 collectively
- §2 non-goals → respected (no task introduces multi-admission / cross-device / scheduling)
- §3 routing (Option C) → Tasks 5, 8
- §4 continuity resolver → Task 2
- §5 Review banner → Task 6
- §6 per-case emit prompts → Task 4
- §7 note label + skill map → Task 3
- §8 schema (NoteType extension) → Task 1
- §9 module changes → Tasks 1-8
- §10 test plan (+8 tests → 30) → actually +9 (4 continuity + 3 prompt + 2 bidi) = 31 total
- §12 ship criteria → Task 10

**Placeholder scan:** None. Every code block is complete.

**Type consistency:**
- `ContinuityContext` interface defined once in Task 2, consumed identically in Tasks 4, 6, 7.
- `NoteType` extended in Task 1, referenced correctly in Tasks 3, 4, 5.
- `listNotesByTeudatZehut` signature matches between Task 1 impl and Task 2 caller.
- `generateNote(noteType, parsed, continuity?)` signature matches between Task 4 definition and Task 7 caller.
- `buildSoapPromptPrefix(continuity)` exported from Task 4, tested directly by same task's test.

**Scope:** One cohesive plan, 10 tasks, targets a single v1.1.0 ship.
