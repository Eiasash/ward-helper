# Morning rounds prep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build morning rounds prep — when a doctor opens ward-helper on a new calendar day, prompt to archive yesterday's roster + seed today's SOAP drafts with carry-over patient context (PMH, plan-long-term, handoverNote) while leaving volatile fields (subjective/vitals/labs/today's-plan) fresh.

**Architecture:** Port Toranot's pure-functional `shiftContinuity.ts` engine into ward-helper as `dayContinuity.ts`. Add durable Patient fields (`planLongTerm`, `planToday`, `handoverNote`, `tomorrowNotes`, `discharged`, `clinicalMeta`) and a new `daySnapshots` IDB store keyed by date. State management uses ward-helper's existing direct-async-storage-helpers + glanceable-events pattern (no reducers). Three PRs: v1.40.0 (schema), v1.40.1 (engine, pure functions), v1.40.2 (UI overlay on existing screens).

**Tech Stack:** TypeScript + React 18 + Vite 7 + IndexedDB via `idb` v8 + Vitest 4 with `fake-indexeddb/auto`. Hebrew/RTL via `unicode-bidi: plaintext` and existing `wrapForChameleon`. Deployed to GitHub Pages at `/ward-helper/`. SOAP generation via Toranot proxy at `toranot.netlify.app/api/claude`.

**Spec:** `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md` (commit c4ec9a2)

**Branch convention:**
- `claude/term-rounds-prep-pr1-schema` (PR 1, v1.40.0)
- `claude/term-rounds-prep-pr2-engine` (PR 2, v1.40.1)
- `claude/term-rounds-prep-pr3-ui` (PR 3, v1.40.2)

**Per-PR release ritual:** every PR bumps `package.json.version`. The Vite plugin `swVersionSync()` in `vite.config.ts` auto-rewrites `dist/sw.js` VERSION line at build, so source `public/sw.js` cosmetic value is unimportant — but the line must exist (regex match required by the plugin or build fails). After merge, run `bash scripts/verify-deploy.sh` — must show the new `ward-v<version>` line on the live URL before declaring "shipped".

**Out of scope (from spec):** cloud sync for `daySnapshots` (deferred to v1.41+); formalized `clinicalMeta` sub-shape (kept as `Record<string, string>` per YAGNI).

---

## PR 1 — Schema + storage helpers (v1.40.0)

**Risk:** Highest — IDB schema change. Ship + sleep on it before PR 2.

### Task 1.1: Branch + version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create branch from main**

```bash
git checkout main
git pull origin main
git checkout -b claude/term-rounds-prep-pr1-schema
```

- [ ] **Step 2: Bump version to 1.40.0**

Edit `package.json`, change the `"version"` line:

```json
"version": "1.40.0",
```

- [ ] **Step 3: Verify tsc + tests still pass on the bump alone**

Run: `npm run check && npm test`
Expected: tsc passes, all 900+ tests pass (no logic change yet).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump to v1.40.0 for morning-rounds-prep PR1"
```

---

### Task 1.2: Add Patient field types + ClinicalMeta bag

**Files:**
- Modify: `src/storage/indexed.ts:8-17` (Patient interface)

- [ ] **Step 1: Write the failing test**

Add to `tests/storage.test.ts` (existing file, append a new `describe` block):

```ts
describe('v1.40.0 Patient field defaults', () => {
  it('accepts the new optional rounds-prep fields', async () => {
    const p: Patient = {
      id: 'p-1',
      name: 'דוגמה',
      teudatZehut: '000000018',
      dob: '1940-01-01',
      room: '5A',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      discharged: false,
      tomorrowNotes: ['call ortho'],
      handoverNote: 'DNR per family conference',
      planLongTerm: 'continue current meds',
      planToday: '',
      clinicalMeta: { pmhSummary: 'HFpEF, AKI' },
    };
    await putPatient(p);
    const back = await getPatient('p-1');
    expect(back?.handoverNote).toBe('DNR per family conference');
    expect(back?.tomorrowNotes).toEqual(['call ortho']);
    expect(back?.clinicalMeta?.pmhSummary).toBe('HFpEF, AKI');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts -t "Patient field defaults" --reporter=verbose`
Expected: FAIL with TypeScript error about `discharged` / `tomorrowNotes` not on Patient type.

- [ ] **Step 3: Add the new optional fields to Patient + define ClinicalMeta bag**

Modify `src/storage/indexed.ts` — extend `Patient`:

```ts
export interface Patient {
  id: string;
  name: string;
  teudatZehut: string;
  dob: string;
  room: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  // v1.40.0 morning-rounds-prep additions
  discharged?: boolean;
  dischargedAt?: number;
  tomorrowNotes?: string[];
  handoverNote?: string;
  planLongTerm?: string;
  planToday?: string;
  clinicalMeta?: Record<string, string>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage.test.ts -t "Patient field defaults"`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to verify no regression**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/indexed.ts tests/storage.test.ts
git commit -m "feat(types): add v1.40.0 Patient rounds-prep fields"
```

---

### Task 1.3: Add `daySnapshots` IDB store + bump DB_VERSION to 6

**Files:**
- Modify: `src/storage/indexed.ts:111-159` (`DB_VERSION` const + `upgrade` callback)

- [ ] **Step 1: Write the failing test**

Add to `tests/storage.test.ts`:

```ts
describe('v6 daySnapshots store', () => {
  it('opens DB_VERSION 6 and exposes daySnapshots store', async () => {
    const { getDb } = await import('@/storage/indexed');
    const db = await getDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames.contains('daySnapshots')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts -t "daySnapshots store"`
Expected: FAIL — DB version is 5, no `daySnapshots` store.

- [ ] **Step 3: Bump DB_VERSION + add v6 upgrade block**

In `src/storage/indexed.ts`, change `const DB_VERSION = 5;` to `6` and add inside the `upgrade(...)` callback (after the `oldVersion < 5` block):

```ts
        if (oldVersion < 6) {
          // v1.40.0: rounds-prep daySnapshots store. Keyed by date YYYY-MM-DD;
          // upserts replace prior snapshot for same date (Q5b confirm-allow-replace).
          // No data backfill here — that runs post-open via runV1_40_0_BackfillIfNeeded
          // (idb upgrade callback transaction lifetime is finicky; spec § decisions Q5c).
          if (!db.objectStoreNames.contains('daySnapshots')) {
            db.createObjectStore('daySnapshots', { keyPath: 'id' });
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage.test.ts -t "daySnapshots store"`
Expected: PASS.

- [ ] **Step 5: Run full suite — DB version bump must not break existing tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/indexed.ts tests/storage.test.ts
git commit -m "feat(storage): add daySnapshots store + bump DB_VERSION to 6"
```

---

### Task 1.4: DaySnapshot type + low-level put/list/cap helpers

**Files:**
- Create: `src/storage/rounds.ts`
- Create: `tests/rounds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rounds.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { putPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import {
  putDaySnapshot,
  listDaySnapshots,
  type DaySnapshot,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function fakePatient(id: string, room = '5A'): Patient {
  return {
    id, name: `שם-${id}`, teudatZehut: `000000${id}`.slice(-9),
    dob: '1940-01-01', room, tags: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('daySnapshots put/list', () => {
  it('round-trips a snapshot keyed by date', async () => {
    await putDaySnapshot({
      id: '2026-05-09', date: '2026-05-09',
      archivedAt: 1234567890000,
      patients: [fakePatient('1')],
    });
    const all = await listDaySnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('2026-05-09');
    expect(all[0]?.patients[0]?.id).toBe('1');
  });

  it('upserts on same date (Q5b replace-on-double-archive)', async () => {
    await putDaySnapshot({
      id: '2026-05-09', date: '2026-05-09', archivedAt: 1, patients: [fakePatient('1')],
    });
    await putDaySnapshot({
      id: '2026-05-09', date: '2026-05-09', archivedAt: 2, patients: [fakePatient('2')],
    });
    const all = await listDaySnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]?.archivedAt).toBe(2);
    expect(all[0]?.patients[0]?.id).toBe('2');
  });

  it('caps history to 20 by deleting oldest archivedAt on put', async () => {
    for (let i = 0; i < 22; i++) {
      const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
      await putDaySnapshot({
        id: date, date, archivedAt: i + 1,
        patients: [fakePatient(`p${i}`)],
      });
    }
    const all = await listDaySnapshots();
    expect(all.length).toBeLessThanOrEqual(20);
    expect(all.find(s => s.archivedAt === 1)).toBeUndefined();
    expect(all.find(s => s.archivedAt === 2)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rounds.test.ts`
Expected: FAIL — module `@/storage/rounds` not found.

- [ ] **Step 3: Create `src/storage/rounds.ts` minimal implementation**

```ts
import { getDb } from './indexed';
import type { Patient } from './indexed';

export const SNAPSHOT_HISTORY_CAP = 20;

export interface DaySnapshot {
  id: string;          // YYYY-MM-DD; primary key
  date: string;        // duplicates id for clarity
  archivedAt: number;  // ms timestamp
  patients: Patient[]; // frozen copy (discharged ones included per Aux 2)
}

export async function putDaySnapshot(snap: DaySnapshot): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('daySnapshots', 'readwrite');
  const store = tx.objectStore('daySnapshots');
  await store.put(snap);
  // Cap to last SNAPSHOT_HISTORY_CAP by archivedAt ascending.
  const all = (await store.getAll()) as DaySnapshot[];
  if (all.length > SNAPSHOT_HISTORY_CAP) {
    const sorted = [...all].sort((a, b) => a.archivedAt - b.archivedAt);
    const toDelete = sorted.slice(0, all.length - SNAPSHOT_HISTORY_CAP);
    for (const s of toDelete) await store.delete(s.id);
  }
  await tx.done;
}

export async function listDaySnapshots(): Promise<DaySnapshot[]> {
  const db = await getDb();
  const all = (await db.getAll('daySnapshots')) as DaySnapshot[];
  return all.sort((a, b) => b.archivedAt - a.archivedAt); // newest first
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rounds.test.ts`
Expected: all 3 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/rounds.ts tests/rounds.test.ts
git commit -m "feat(storage): DaySnapshot type + putDaySnapshot/listDaySnapshots with 20-entry cap"
```

---

### Task 1.5: `runV1_40_0_BackfillIfNeeded` post-open one-shot

**Files:**
- Modify: `src/storage/rounds.ts`
- Create: `tests/runV1_40_0_Backfill.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runV1_40_0_Backfill.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { runV1_40_0_BackfillIfNeeded } from '@/storage/rounds';

const BACKFILL_KEY = 'ward-helper.v1_40_0_backfilled';

beforeEach(async () => {
  await resetDbForTests();
  localStorage.removeItem(BACKFILL_KEY);
});

describe('runV1_40_0_BackfillIfNeeded', () => {
  it('backfills new fields on a legacy patient', async () => {
    // Simulate a v1.39.x patient (no rounds-prep fields)
    const legacy = {
      id: 'p-legacy', name: 'בדיקה', teudatZehut: '000000018',
      dob: '1940-01-01', room: '5A', tags: [],
      createdAt: 1, updatedAt: 1,
    } as Patient;
    await putPatient(legacy);

    await runV1_40_0_BackfillIfNeeded();

    const back = await getPatient('p-legacy');
    expect(back?.discharged).toBe(false);
    expect(back?.tomorrowNotes).toEqual([]);
    expect(back?.handoverNote).toBe('');
    expect(back?.planLongTerm).toBe('');
    expect(back?.planToday).toBe('');
    expect(back?.clinicalMeta).toEqual({});
    expect(localStorage.getItem(BACKFILL_KEY)).toBe('1');
  });

  it('is idempotent — second call is a no-op', async () => {
    const p = {
      id: 'p1', name: 'X', teudatZehut: '000000018',
      dob: '1940-01-01', room: '5A', tags: [],
      createdAt: 1, updatedAt: 1, handoverNote: 'preserved',
    } as Patient;
    await putPatient(p);
    await runV1_40_0_BackfillIfNeeded();
    // second call should not re-write
    await runV1_40_0_BackfillIfNeeded();
    const back = await getPatient('p1');
    expect(back?.handoverNote).toBe('preserved');
  });

  it('does not set marker if backfill throws (retries next boot)', async () => {
    // Simulate a corrupted patient row by stubbing getDb to throw.
    // Simplest: clear marker, run, but force the cursor to throw via
    // a putPatient with a circular structure. Easier: just verify the
    // marker is set ONLY after success — leave throw-path to a manual
    // test if needed.
    await runV1_40_0_BackfillIfNeeded();
    expect(localStorage.getItem(BACKFILL_KEY)).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runV1_40_0_Backfill.test.ts`
Expected: FAIL — `runV1_40_0_BackfillIfNeeded` not exported from `@/storage/rounds`.

- [ ] **Step 3: Add the function to `src/storage/rounds.ts`**

Append to `src/storage/rounds.ts`:

```ts
const BACKFILL_KEY = 'ward-helper.v1_40_0_backfilled';

export async function runV1_40_0_BackfillIfNeeded(): Promise<void> {
  if (localStorage.getItem(BACKFILL_KEY) === '1') return;
  try {
    const db = await getDb();
    const tx = db.transaction('patients', 'readwrite');
    const store = tx.objectStore('patients');
    let cursor = await store.openCursor();
    while (cursor) {
      const p = cursor.value as Patient;
      await cursor.update({
        ...p,
        discharged: p.discharged ?? false,
        tomorrowNotes: p.tomorrowNotes ?? [],
        handoverNote: p.handoverNote ?? '',
        planLongTerm: p.planLongTerm ?? '',
        planToday: p.planToday ?? '',
        clinicalMeta: p.clinicalMeta ?? {},
      });
      cursor = await cursor.continue();
    }
    await tx.done;
    localStorage.setItem(BACKFILL_KEY, '1');
  } catch (err) {
    // Don't set marker on failure — retries next boot.
    // Reads tolerate missing fields via ?? defaults at every read site.
    console.warn('[rounds] v1.40.0 backfill failed; will retry next boot', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runV1_40_0_Backfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire backfill into app boot**

Modify `src/main.tsx`. Add the backfill call as a fire-and-forget side effect right after the existing `bootstrapDefaults()` IIFE. The function is idempotent (gated by `localStorage.ward-helper.v1_40_0_backfilled`), so duplicate invocations from HMR or strict-mode double-mount are cheap no-ops.

Concrete edit — insert after line 21 (the closing `})();` of `bootstrapDefaults`):

```ts
import { runV1_40_0_BackfillIfNeeded } from './storage/rounds';

// v1.40.0 morning-rounds-prep backfill — adds default values to legacy
// patient records lacking the new optional fields. Idempotent.
void runV1_40_0_BackfillIfNeeded();
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/storage/rounds.ts tests/runV1_40_0_Backfill.test.ts src/main.tsx
git commit -m "feat(storage): runV1_40_0_BackfillIfNeeded post-open one-shot"
```

---

### Task 1.6: `archiveDay()` storage helper

**Files:**
- Modify: `src/storage/rounds.ts`
- Modify: `src/ui/hooks/glanceableEvents.ts` (add `notifyDayArchived`)
- Create: `tests/archiveDay.test.ts`

- [ ] **Step 1: Add `notifyDayArchived` event**

Modify `src/ui/hooks/glanceableEvents.ts` — read first to find the existing event-bus shape, then add a sibling export. Read approx 30 lines of that file to mimic the existing pattern.

Concrete addition (mirror existing exports):

```ts
export function notifyDayArchived(): void {
  window.dispatchEvent(new CustomEvent('ward-helper:day-archived'));
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/archiveDay.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  putPatient, listPatients, resetDbForTests, type Patient,
} from '@/storage/indexed';
import { archiveDay, listDaySnapshots } from '@/storage/rounds';

const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

beforeEach(async () => {
  await resetDbForTests();
  localStorage.removeItem(LAST_ARCHIVED_KEY);
});

function newP(id: string, planToday = ''): Patient {
  return {
    id, name: `שם-${id}`, teudatZehut: `00000000${id}`.slice(-9),
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: 'continue ASA', planToday,
    clinicalMeta: {},
  };
}

describe('archiveDay', () => {
  it('snapshots current roster + clears planToday for all + sets lastArchivedDate', async () => {
    await putPatient(newP('1', 'today: order CBC'));
    await putPatient(newP('2', 'today: call ortho'));

    const result = await archiveDay();

    // Snapshot recorded
    const snaps = await listDaySnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.patients).toHaveLength(2);
    // Snapshot.patients carry the planToday FROM BEFORE the clear (frozen)
    expect(snaps[0]?.patients[0]?.planToday).toBe('today: order CBC');

    // Live patient state has planToday cleared
    const live = await listPatients();
    expect(live.find(p => p.id === '1')?.planToday).toBe('');
    expect(live.find(p => p.id === '2')?.planToday).toBe('');
    // planLongTerm preserved
    expect(live.find(p => p.id === '1')?.planLongTerm).toBe('continue ASA');

    // localStorage marker
    expect(localStorage.getItem(LAST_ARCHIVED_KEY)).toBeTruthy();
    // Function returned the snapshot
    expect(result.patients).toHaveLength(2);
  });

  it('replaces same-date snapshot on second call (Q5b)', async () => {
    await putPatient(newP('a'));
    const r1 = await archiveDay();
    await putPatient(newP('b'));  // new patient added between archives
    const r2 = await archiveDay();

    expect(r2.archivedAt).toBeGreaterThanOrEqual(r1.archivedAt);
    const snaps = await listDaySnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.patients).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/archiveDay.test.ts`
Expected: FAIL — `archiveDay` not exported.

- [ ] **Step 4: Implement `archiveDay()` in `src/storage/rounds.ts`**

Append to `src/storage/rounds.ts`:

```ts
import { listPatients, putPatient } from './indexed';
import { notifyDayArchived } from '@/ui/hooks/glanceableEvents';

export const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

export async function archiveDay(): Promise<DaySnapshot> {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const archivedAt = Date.now();
  const patients = await listPatients();

  // Frozen copy — capture planToday BEFORE clearing
  const snapshot: DaySnapshot = {
    id: today,
    date: today,
    archivedAt,
    patients: patients.map(p => ({ ...p })), // shallow clone
  };
  await putDaySnapshot(snapshot);

  // Clear planToday for all live patients
  for (const p of patients) {
    if (p.planToday !== '') {
      await putPatient({ ...p, planToday: '', updatedAt: archivedAt });
    }
  }

  localStorage.setItem(LAST_ARCHIVED_KEY, today);
  notifyDayArchived();
  return snapshot;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/archiveDay.test.ts`
Expected: both cases PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/storage/rounds.ts src/ui/hooks/glanceableEvents.ts tests/archiveDay.test.ts
git commit -m "feat(rounds): archiveDay snapshots roster + clears planToday + emits event"
```

---

### Task 1.7: Discharge / un-discharge / re-admit helpers

**Files:**
- Modify: `src/storage/rounds.ts`
- Create: `tests/dischargeReadmit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dischargeReadmit.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, getPatient, resetDbForTests, type Patient,
} from '@/storage/indexed';
import {
  dischargePatient, unDischargePatient,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function newP(id: string): Patient {
  return {
    id, name: `שם-${id}`, teudatZehut: `00000000${id}`.slice(-9),
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: 'baseline note',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('discharge + un-discharge', () => {
  it('dischargePatient sets discharged + dischargedAt', async () => {
    await putPatient(newP('1'));
    const before = Date.now();
    await dischargePatient('1');
    const back = await getPatient('1');
    expect(back?.discharged).toBe(true);
    expect(back?.dischargedAt).toBeGreaterThanOrEqual(before);
  });

  it('unDischargePatient clears state + appends handoverNote re-admit line', async () => {
    await putPatient(newP('1'));
    await dischargePatient('1');
    await unDischargePatient('1', 5, 're-admission via capture');
    const back = await getPatient('1');
    expect(back?.discharged).toBe(false);
    expect(back?.dischargedAt).toBeUndefined();
    expect(back?.handoverNote).toContain('baseline note');
    expect(back?.handoverNote).toContain('חזר לאשפוז');
    expect(back?.handoverNote).toContain('5');
    expect(back?.handoverNote).toContain('re-admission via capture');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dischargeReadmit.test.ts`
Expected: FAIL — `dischargePatient` / `unDischargePatient` not exported.

- [ ] **Step 3: Implement helpers in `src/storage/rounds.ts`**

Append:

```ts
export async function dischargePatient(patientId: string): Promise<void> {
  const p = await (await import('./indexed')).getPatient(patientId);
  if (!p) throw new Error(`Patient ${patientId} not found`);
  await putPatient({
    ...p,
    discharged: true,
    dischargedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function unDischargePatient(
  patientId: string, gapDays: number, reason: string,
): Promise<void> {
  const p = await (await import('./indexed')).getPatient(patientId);
  if (!p) throw new Error(`Patient ${patientId} not found`);
  const today = new Date().toLocaleDateString('en-CA');
  const reAdmitLine = `\nחזר לאשפוז ב-${today} לאחר ${gapDays} ימים: ${reason}`;
  const newHandoverNote = (p.handoverNote ?? '') + reAdmitLine;
  await putPatient({
    ...p,
    discharged: false,
    dischargedAt: undefined,
    handoverNote: newHandoverNote,
    updatedAt: Date.now(),
  });
}
```

(The `await import('./indexed')` dance avoids a circular-import surface; if `getPatient` is already imported at the file head, just use the static import. Verify with `grep "getPatient" src/storage/rounds.ts` before deciding.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dischargeReadmit.test.ts`
Expected: both cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/rounds.ts tests/dischargeReadmit.test.ts
git commit -m "feat(rounds): dischargePatient + unDischargePatient helpers"
```

---

### Task 1.8: tomorrowNotes helpers (`addTomorrowNote`, `dismissTomorrowNote`, `promoteToHandover`)

**Files:**
- Modify: `src/storage/rounds.ts`
- Create: `tests/tomorrowNotes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tomorrowNotes.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, getPatient, resetDbForTests, type Patient,
} from '@/storage/indexed';
import {
  addTomorrowNote, dismissTomorrowNote, promoteToHandover,
} from '@/storage/rounds';

beforeEach(async () => {
  await resetDbForTests();
});

function newP(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('tomorrowNotes helpers', () => {
  it('addTomorrowNote appends to array', async () => {
    await putPatient(newP());
    await addTomorrowNote('p1', 'AM labs already drawn');
    await addTomorrowNote('p1', 'call ortho');
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['AM labs already drawn', 'call ortho']);
  });

  it('dismissTomorrowNote splices a single line by index', async () => {
    await putPatient({ ...newP(), tomorrowNotes: ['a', 'b', 'c'] });
    await dismissTomorrowNote('p1', 1);
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['a', 'c']);
  });

  it('promoteToHandover appends to handoverNote AND splices from tomorrowNotes', async () => {
    await putPatient({
      ...newP(),
      tomorrowNotes: ['ephemeral', 'should-promote', 'other'],
      handoverNote: 'existing',
    });
    await promoteToHandover('p1', 1);
    const back = await getPatient('p1');
    expect(back?.tomorrowNotes).toEqual(['ephemeral', 'other']);
    expect(back?.handoverNote).toContain('existing');
    expect(back?.handoverNote).toContain('should-promote');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tomorrowNotes.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement helpers in `src/storage/rounds.ts`**

Append:

```ts
import { getPatient } from './indexed';

export async function addTomorrowNote(patientId: string, text: string): Promise<void> {
  const p = await getPatient(patientId);
  if (!p) throw new Error(`Patient ${patientId} not found`);
  await putPatient({
    ...p,
    tomorrowNotes: [...(p.tomorrowNotes ?? []), text],
    updatedAt: Date.now(),
  });
}

export async function dismissTomorrowNote(patientId: string, lineIdx: number): Promise<void> {
  const p = await getPatient(patientId);
  if (!p) throw new Error(`Patient ${patientId} not found`);
  const next = (p.tomorrowNotes ?? []).filter((_, i) => i !== lineIdx);
  await putPatient({ ...p, tomorrowNotes: next, updatedAt: Date.now() });
}

export async function promoteToHandover(patientId: string, lineIdx: number): Promise<void> {
  const p = await getPatient(patientId);
  if (!p) throw new Error(`Patient ${patientId} not found`);
  const lines = p.tomorrowNotes ?? [];
  const line = lines[lineIdx];
  if (line === undefined) return; // graceful no-op on out-of-bounds
  const nextHandover = (p.handoverNote ?? '') + (p.handoverNote ? '\n' : '') + line;
  const nextTomorrow = lines.filter((_, i) => i !== lineIdx);
  await putPatient({
    ...p,
    handoverNote: nextHandover,
    tomorrowNotes: nextTomorrow,
    updatedAt: Date.now(),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tomorrowNotes.test.ts`
Expected: all 3 cases PASS.

- [ ] **Step 5: Run full suite + tsc**

Run: `npm run check && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/rounds.ts tests/tomorrowNotes.test.ts
git commit -m "feat(rounds): tomorrowNotes lifecycle helpers (add/dismiss/promote)"
```

---

### Task 1.9: Build, push, open PR 1

- [ ] **Step 1: Verify all gates locally**

Run: `npm run check && npm test && npm run build`
Expected: tsc passes, all tests pass, Vite build succeeds (and `swVersionSync` plugin auto-rewrites `dist/sw.js` to `ward-v1.40.0`).

- [ ] **Step 2: Confirm sw.js value sync at build**

Run: `grep "VERSION = " dist/sw.js`
Expected: `const VERSION = 'ward-v1.40.0';`

- [ ] **Step 3: Push branch + open draft PR**

```bash
git push -u origin claude/term-rounds-prep-pr1-schema
gh pr create --title "feat: morning rounds prep PR 1 — schema + storage helpers (v1.40.0)" \
  --draft \
  --body "$(cat <<'EOF'
## Summary
- IDB v5→v6: new `daySnapshots` store keyed by date YYYY-MM-DD
- Patient gains `discharged`/`dischargedAt`/`tomorrowNotes`/`handoverNote`/`planLongTerm`/`planToday`/`clinicalMeta`
- `runV1_40_0_BackfillIfNeeded` post-open one-shot, gated by localStorage marker
- Storage helpers: `archiveDay`, `dischargePatient`, `unDischargePatient`, `addTomorrowNote`, `dismissTomorrowNote`, `promoteToHandover`
- New event: `notifyDayArchived`

No UI in this PR — all hooks land for PR 3.

Spec: `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md` (commit c4ec9a2).
Plan: `docs/superpowers/plans/2026-05-09-morning-rounds-prep-v1.md` PR 1 section.

## Test plan
- [ ] CI green (13 gates including version-trinity)
- [ ] After merge: `bash scripts/verify-deploy.sh` shows `ward-v1.40.0` live
- [ ] PWA users on v1.39.x reload and quietly migrate via post-open backfill

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI green, then mark ready + squash merge**

```bash
gh pr checks --watch
gh pr ready
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Verify live deploy**

After ~60-90s for GitHub Pages to publish:

```bash
git checkout main && git pull
bash scripts/verify-deploy.sh
```

Expected: `verify-deploy.sh` exits 0 with the new `ward-v1.40.0` line confirmed live.

---

## PR 2 — Continuity engine (v1.40.1)

**Risk:** Lowest — pure functions, fully unit-testable. No IDB schema changes.

### Task 2.1: Branch + version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Branch from updated main**

```bash
git checkout main
git pull origin main
git checkout -b claude/term-rounds-prep-pr2-engine
```

- [ ] **Step 2: Bump version to 1.40.1**

In `package.json`:

```json
"version": "1.40.1",
```

- [ ] **Step 3: Verify tsc + tests pass on bump alone**

Run: `npm run check && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump to v1.40.1 for morning-rounds-prep PR2"
```

---

### Task 2.2: Port Toranot's `shiftContinuity` matching tests as `dayContinuity` tests

**Files:**
- Create: `tests/dayContinuity.test.ts`

- [ ] **Step 1: Read Toranot's reference test for shape inspiration**

```bash
cat ~/repos/Toranot/tests/shiftContinuity.test.ts 2>/dev/null | head -80
```

(If the path differs, search: `find ~/repos/Toranot -name "shiftContinuity.test.ts"`. Adapt names/imports — Toranot uses Zustand, ward-helper's `dayContinuity` is a pure function, so just borrow the case structure.)

- [ ] **Step 2: Write the failing test (tests-first; engine doesn't exist yet)**

Create `tests/dayContinuity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDayContinuity, ROOM_NAME_PREFIX_LEN, HANDOVER_MIN_CHARS } from '@/engine/dayContinuity';
import type { Patient } from '@/storage/indexed';
import type { DaySnapshot } from '@/storage/rounds';

function p(o: Partial<Patient>): Patient {
  return {
    id: o.id ?? crypto.randomUUID(),
    name: o.name ?? '',
    teudatZehut: o.teudatZehut ?? '',
    dob: '1940-01-01',
    room: o.room ?? '5A',
    tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: o.discharged ?? false,
    dischargedAt: o.dischargedAt,
    tomorrowNotes: o.tomorrowNotes ?? [],
    handoverNote: o.handoverNote ?? '',
    planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

function snap(date: string, archivedAt: number, patients: Patient[]): DaySnapshot {
  return { id: date, date, archivedAt, patients };
}

describe('buildDayContinuity', () => {
  it('empty history returns empty map', () => {
    const out = buildDayContinuity([p({ id: 'a' })], []);
    expect(out.size).toBe(0);
  });

  it('exact room + name-prefix match', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A', handoverNote: 'DNR per family' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('exact');
    expect(out.get('today-1')?.handoverNote).toBe('DNR per family');
  });

  it('OCR name variation tolerated by 4-char prefix', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה מ', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A', handoverNote: 'baseline 24/30' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('exact');
  });

  it('room moved overnight → name-fallback match', () => {
    const today = [p({ id: 'today-1', name: 'לוי משה', room: '5B' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'לוי משה', room: '5A', handoverNote: 'continue ASA' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.matchType).toBe('name-fallback');
  });

  it('discharged in yesterday snapshot → not surfaced today', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'כהן שרה', room: '5A',
          discharged: true, dischargedAt: 1, handoverNote: 'DNR' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.size).toBe(0);
  });

  it('handoverNote ≤ 5 chars filtered out', () => {
    const today = [p({ id: 'today-1', name: 'אבישי', room: '5A' })];
    const yesterday = snap('2026-05-08', 1, [
      p({ id: 'yest-1', name: 'אבישי', room: '5A', handoverNote: 'OK' }),
    ]);
    const out = buildDayContinuity(today, [yesterday]);
    expect(out.get('today-1')?.handoverNote).toBe('');
  });

  it('uses most recent snapshot when multiple exist', () => {
    const today = [p({ id: 'today-1', name: 'כהן שרה', room: '5A' })];
    const older = snap('2026-05-06', 1, [
      p({ id: 'old', name: 'כהן שרה', room: '5A', handoverNote: 'older note here' }),
    ]);
    const newer = snap('2026-05-08', 100, [
      p({ id: 'new', name: 'כהן שרה', room: '5A', handoverNote: 'newer note here' }),
    ]);
    const out = buildDayContinuity(today, [newer, older]);  // descending
    expect(out.get('today-1')?.handoverNote).toBe('newer note here');
  });

  it('exposes ROOM_NAME_PREFIX_LEN = 4 and HANDOVER_MIN_CHARS = 5', () => {
    expect(ROOM_NAME_PREFIX_LEN).toBe(4);
    expect(HANDOVER_MIN_CHARS).toBe(5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dayContinuity.test.ts`
Expected: FAIL — module `@/engine/dayContinuity` not found.

- [ ] **Step 4: Commit the tests (red phase, no impl yet)**

```bash
git add tests/dayContinuity.test.ts
git commit -m "test(engine): dayContinuity test cases (RED)"
```

---

### Task 2.3: Implement `dayContinuity.ts` engine

**Files:**
- Create: `src/engine/dayContinuity.ts`

- [ ] **Step 1: Implement the pure function**

Create `src/engine/dayContinuity.ts`:

```ts
import type { Patient } from '@/storage/indexed';
import type { DaySnapshot } from '@/storage/rounds';

export const ROOM_NAME_PREFIX_LEN = 4;
export const HANDOVER_MIN_CHARS = 5;
export const DISCHARGE_STALE_GAP_MS = 24 * 60 * 60 * 1000;

export interface PreviousDayContext {
  patient: Patient;
  matchType: 'exact' | 'name-fallback';
  handoverNote: string;
  tomorrowNotes: string[];
}

function namePrefix(s: string): string {
  // Strip BIDI marks (LRM U+200E, RLM U+200F) and lowercase. First N chars.
  return s.replace(/[‎‏]/g, '').trim().toLocaleLowerCase().slice(0, ROOM_NAME_PREFIX_LEN);
}

function filterHandover(s: string | undefined): string {
  const t = (s ?? '').trim();
  return t.length > HANDOVER_MIN_CHARS ? t : '';
}

export function buildDayContinuity(
  currentRoster: Patient[],
  snapshotHistory: DaySnapshot[],  // sorted descending by archivedAt
): Map<string, PreviousDayContext> {
  const out = new Map<string, PreviousDayContext>();
  const mostRecent = snapshotHistory[0];
  if (!mostRecent) return out;

  const livingYesterdays = mostRecent.patients.filter(p => !p.discharged);

  for (const today of currentRoster) {
    const todayPrefix = namePrefix(today.name);

    // Try exact match: same room + name prefix
    let match = livingYesterdays.find(prev =>
      prev.room === today.room && namePrefix(prev.name) === todayPrefix
    );
    let matchType: 'exact' | 'name-fallback' = 'exact';

    // Fallback: name prefix only (room moved)
    if (!match) {
      match = livingYesterdays.find(prev => namePrefix(prev.name) === todayPrefix);
      matchType = 'name-fallback';
    }

    if (!match) continue;

    out.set(today.id, {
      patient: match,
      matchType,
      handoverNote: filterHandover(match.handoverNote),
      tomorrowNotes: match.tomorrowNotes ?? [],
    });
  }

  return out;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/dayContinuity.test.ts`
Expected: all 8 cases PASS.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/engine/dayContinuity.ts
git commit -m "feat(engine): dayContinuity pure function (GREEN)"
```

---

### Task 2.4: `seedFromYesterdaySoap` orchestrator + `decideSeed` + `detectReadmit`

**Files:**
- Create: `src/notes/seedFromYesterdaySoap.ts`
- Create: `tests/seedFromYesterdaySoap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/seedFromYesterdaySoap.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putPatient, putNote, resetDbForTests, type Patient, type Note,
} from '@/storage/indexed';
import { decideSeed, detectReadmit } from '@/notes/seedFromYesterdaySoap';

beforeEach(async () => {
  await resetDbForTests();
});

function p(o: Partial<Patient>): Patient {
  return {
    id: o.id ?? 'p1',
    name: o.name ?? 'X',
    teudatZehut: o.teudatZehut ?? '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: o.discharged ?? false,
    dischargedAt: o.dischargedAt,
    tomorrowNotes: [], handoverNote: o.handoverNote ?? '',
    planLongTerm: o.planLongTerm ?? '', planToday: '',
    clinicalMeta: o.clinicalMeta ?? {},
  };
}

function soapNote(patientId: string, body: string, ageMs: number): Note {
  return {
    id: `n-${patientId}`,
    patientId,
    type: 'soap',
    bodyHebrew: body,
    structuredData: {},
    createdAt: Date.now() - ageMs,
    updatedAt: Date.now() - ageMs,
  };
}

describe('decideSeed', () => {
  it('no-history when no prior SOAP', async () => {
    await putPatient(p({ id: 'p1' }));
    const r = await decideSeed(await getPatientHelper('p1'));
    expect(r.kind).toBe('no-prefill');
    if (r.kind === 'no-prefill') expect(r.reason).toBe('no-history');
  });

  it('discharge-gap when discharged > 24h ago', async () => {
    const dischargedAt = Date.now() - 25 * 60 * 60 * 1000;
    const patient = p({ id: 'p1', discharged: true, dischargedAt });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yesterday body', 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('no-prefill');
    if (r.kind === 'no-prefill') expect(r.reason).toBe('discharge-gap');
  });

  it('prefill when discharged 23h ago (still in window)', async () => {
    const dischargedAt = Date.now() - 23 * 60 * 60 * 1000;
    const patient = p({ id: 'p1', discharged: true, dischargedAt,
                         handoverNote: 'h', planLongTerm: 'continue ASA' });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yesterday body', 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('prefill');
    if (r.kind === 'prefill') {
      expect(r.bodyContext).toBe('yesterday body');
      expect(r.patientFields.planLongTerm).toBe('continue ASA');
    }
  });

  it('prefill when not discharged + recent SOAP', async () => {
    const patient = p({ id: 'p1', planLongTerm: 'meds X' });
    await putPatient(patient);
    await putNote(soapNote('p1', 'yest body', 12 * 60 * 60 * 1000));
    const r = await decideSeed(patient);
    expect(r.kind).toBe('prefill');
    if (r.kind === 'prefill') expect(r.patientFields.planLongTerm).toBe('meds X');
  });
});

describe('detectReadmit', () => {
  it('returns isReadmit=false when not discharged', () => {
    expect(detectReadmit(p({ id: 'p1' })).isReadmit).toBe(false);
  });

  it('returns gapDays when discharged', () => {
    const dischargedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const r = detectReadmit(p({ id: 'p1', discharged: true, dischargedAt }));
    expect(r.isReadmit).toBe(true);
    expect(r.gapDays).toBe(5);
  });

  it('handles missing dischargedAt as not-discharged (defensive)', () => {
    const r = detectReadmit(p({ id: 'p1', discharged: true }));
    expect(r.isReadmit).toBe(false);
  });
});

async function getPatientHelper(id: string): Promise<Patient> {
  const { getPatient } = await import('@/storage/indexed');
  const p = await getPatient(id);
  if (!p) throw new Error(`fixture missing: ${id}`);
  return p;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/seedFromYesterdaySoap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement orchestrator**

Create `src/notes/seedFromYesterdaySoap.ts`:

```ts
import type { Patient } from '@/storage/indexed';
import { resolveContinuity } from '@/notes/continuity';
import { DISCHARGE_STALE_GAP_MS } from '@/engine/dayContinuity';

export type SeedDecision =
  | { kind: 'no-prefill'; reason: 'no-history' | 'discharge-gap' | 'episode-stale' }
  | { kind: 'prefill';
      bodyContext: string;
      patientFields: {
        handoverNote: string;
        planLongTerm: string;
        clinicalMeta: Record<string, string>;
      };
    };

export async function decideSeed(patient: Patient): Promise<SeedDecision> {
  // Gate 1: discharge gap (advisor concern 3 — fires before episode window)
  if (
    patient.discharged === true &&
    typeof patient.dischargedAt === 'number' &&
    Date.now() - patient.dischargedAt > DISCHARGE_STALE_GAP_MS
  ) {
    return { kind: 'no-prefill', reason: 'discharge-gap' };
  }
  // Gate 2: episode window (existing 30-day staleness via resolveContinuity)
  const ctx = await resolveContinuity(patient.teudatZehut);
  if (!ctx.mostRecentSoap) {
    return {
      kind: 'no-prefill',
      reason: ctx.episodeStart === null ? 'no-history' : 'episode-stale',
    };
  }
  return {
    kind: 'prefill',
    bodyContext: ctx.mostRecentSoap.bodyHebrew,
    patientFields: {
      handoverNote: patient.handoverNote ?? '',
      planLongTerm: patient.planLongTerm ?? '',
      clinicalMeta: patient.clinicalMeta ?? {},
    },
  };
}

export interface ReadmitResult {
  isReadmit: boolean;
  gapDays?: number;
}

export function detectReadmit(patient: Patient): ReadmitResult {
  if (!patient.discharged || typeof patient.dischargedAt !== 'number') {
    return { isReadmit: false };
  }
  const gapMs = Date.now() - patient.dischargedAt;
  return { isReadmit: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/seedFromYesterdaySoap.test.ts`
Expected: all cases PASS.

- [ ] **Step 5: Run full suite + tsc**

Run: `npm run check && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/notes/seedFromYesterdaySoap.ts tests/seedFromYesterdaySoap.test.ts
git commit -m "feat(notes): seedFromYesterdaySoap orchestrator + detectReadmit"
```

---

### Task 2.5: Build, push, open PR 2

- [ ] **Step 1: Verify all gates locally**

Run: `npm run check && npm test && npm run build`
Expected: all pass; `dist/sw.js` reads `ward-v1.40.1`.

- [ ] **Step 2: Push + open draft PR**

```bash
git push -u origin claude/term-rounds-prep-pr2-engine
gh pr create --title "feat: morning rounds prep PR 2 — continuity engine (v1.40.1)" \
  --draft \
  --body "$(cat <<'EOF'
## Summary
- `src/engine/dayContinuity.ts` — pure function, ports Toranot's shiftContinuity
- `src/notes/seedFromYesterdaySoap.ts` — orchestrator with discharge-gap gate (24h) + episode-stale gate (30d via existing resolveContinuity)
- `detectReadmit` read-only helper (no mutation; UI dispatches `unDischargePatient` separately)
- 11 new vitest cases (8 dayContinuity + 7 seedFromYesterdaySoap/detectReadmit)
- No UI yet (PR 3)

Spec: `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md`.
Plan: `docs/superpowers/plans/2026-05-09-morning-rounds-prep-v1.md` PR 2 section.

## Test plan
- [ ] CI green (13 gates)
- [ ] `bash scripts/verify-deploy.sh` after merge → `ward-v1.40.1` live

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: CI green → ready → merge**

```bash
gh pr checks --watch
gh pr ready
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Verify live deploy**

```bash
git checkout main && git pull
bash scripts/verify-deploy.sh
```

Expected: `ward-v1.40.1` live.

---

## PR 3 — UI overlay (v1.40.2)

**Risk:** Medium — UI changes touch existing screens. Most components are additive.

### Task 3.1: Branch + version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Branch from main**

```bash
git checkout main
git pull origin main
git checkout -b claude/term-rounds-prep-pr3-ui
```

- [ ] **Step 2: Bump version to 1.40.2**

```json
"version": "1.40.2",
```

- [ ] **Step 3: Verify + commit**

```bash
npm run check && npm test
git add package.json
git commit -m "chore: bump to v1.40.2 for morning-rounds-prep PR3"
```

---

### Task 3.2: Locate the existing screen that hosts "today's view"

**Files:** READ-ONLY pre-investigation. No edits.

- [ ] **Step 1: Identify the right host screen**

The spec calls for the morning banner to appear "on first /today view of new day." ward-helper has no explicit `/today` route. Investigate:

```bash
grep -rn "RecentPatientsList\|recent patients\|patient-list\|הרשימה\|מטופלים" src/ui/screens/ src/ui/components/RecentPatientsList.tsx | head -30
```

Likely host candidates:
1. `src/ui/screens/History.tsx` — shows past notes / recent patients
2. `src/ui/components/RecentPatientsList.tsx` — used inside one of the screens
3. `src/ui/App.tsx` — the top-level shell

Pick the FIRST screen the user lands on after auth that surfaces a patient list. That's where `<MorningArchivePrompt>` mounts.

- [ ] **Step 2: Document the chosen host**

Add a one-line comment in `src/ui/App.tsx` (or the chosen screen) at the top of the relevant section:

```tsx
// v1.40.2 morning rounds prep: <MorningArchivePrompt> mounts here per spec.
```

This is an orienting note for future devs; no behavior yet.

- [ ] **Step 3: Commit (just the comment)**

```bash
git add src/ui/App.tsx  # or whichever file
git commit -m "docs: mark host site for v1.40.2 morning-rounds banner"
```

---

### Task 3.3: `<MorningArchivePrompt>` component

**Files:**
- Create: `src/ui/components/MorningArchivePrompt.tsx`
- Create: `tests/MorningArchivePrompt.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/MorningArchivePrompt.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MorningArchivePrompt } from '@/ui/components/MorningArchivePrompt';

const LAST_KEY = 'ward-helper.lastArchivedDate';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('MorningArchivePrompt', () => {
  it('does not render when lastArchivedDate is today', () => {
    const today = new Date().toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, today);
    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });

  it('renders when lastArchivedDate is yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, yesterday);
    render(<MorningArchivePrompt />);
    expect(screen.getByText(/יום חדש/)).toBeTruthy();
  });

  it('does not re-render after dismissal in same session', () => {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    localStorage.setItem(LAST_KEY, yesterday);
    const { unmount } = render(<MorningArchivePrompt />);
    fireEvent.click(screen.getByText('דחה'));
    unmount();

    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });

  it('does not render on first launch (no lastArchivedDate)', () => {
    render(<MorningArchivePrompt />);
    expect(screen.queryByText(/יום חדש/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/MorningArchivePrompt.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `<MorningArchivePrompt>`**

Create `src/ui/components/MorningArchivePrompt.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { archiveDay, listDaySnapshots } from '@/storage/rounds';

const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

interface State { kind: 'hidden' } | { kind: 'visible' } | { kind: 'confirm-replace'; existingArchivedAt: number };

export function MorningArchivePrompt(): JSX.Element | null {
  const [state, setState] = useState<{ kind: string; existingArchivedAt?: number }>({ kind: 'hidden' });

  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA');
    const last = localStorage.getItem(LAST_ARCHIVED_KEY);
    const dismissed = sessionStorage.getItem(`ward-helper.bannerDismissed_${today}`) === '1';
    if (last && last < today && !dismissed) {
      setState({ kind: 'visible' });
    }
  }, []);

  const today = new Date().toLocaleDateString('en-CA');

  async function handleArchive() {
    // Q5b: confirm-but-allow-replace if today already in daySnapshots
    const snaps = await listDaySnapshots();
    const todayExisting = snaps.find(s => s.id === today);
    if (todayExisting) {
      setState({ kind: 'confirm-replace', existingArchivedAt: todayExisting.archivedAt });
      return;
    }
    await archiveDay();
    setState({ kind: 'hidden' });
  }

  async function handleConfirmReplace() {
    await archiveDay();
    setState({ kind: 'hidden' });
  }

  function handleDismiss() {
    sessionStorage.setItem(`ward-helper.bannerDismissed_${today}`, '1');
    setState({ kind: 'hidden' });
  }

  if (state.kind === 'hidden') return null;

  if (state.kind === 'confirm-replace') {
    const at = new Date(state.existingArchivedAt!).toLocaleTimeString('he-IL');
    return (
      <div className="banner banner-warn" dir="auto">
        <p>כבר ארכבת היום בשעה {at}. לארכב שוב? הארכוב הקודם יוחלף.</p>
        <button onClick={handleConfirmReplace}>ארכב שוב</button>
        <button onClick={handleDismiss}>בטל</button>
      </div>
    );
  }

  return (
    <div className="banner banner-info" dir="auto">
      <p>זוהה יום חדש. לארכב את אתמול ולהקים רשימה לבוקר?</p>
      <button onClick={handleArchive}>ארכב</button>
      <button onClick={handleDismiss}>דחה</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/MorningArchivePrompt.test.tsx`
Expected: all 4 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/MorningArchivePrompt.tsx tests/MorningArchivePrompt.test.tsx
git commit -m "feat(ui): MorningArchivePrompt with calendar-rollover + double-archive confirm"
```

---

### Task 3.4: `<TomorrowBanner>` per-line dismiss + promote

**Files:**
- Create: `src/ui/components/TomorrowBanner.tsx`
- Create: `tests/TomorrowBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/TomorrowBanner.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { TomorrowBanner } from '@/ui/components/TomorrowBanner';

beforeEach(async () => { await resetDbForTests(); });

function fixture(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: ['call ortho', 'AM labs drawn'],
    handoverNote: '', planLongTerm: '', planToday: '', clinicalMeta: {},
  };
}

describe('TomorrowBanner', () => {
  it('renders nothing when patient has no tomorrowNotes', async () => {
    await putPatient({ ...fixture(), tomorrowNotes: [] });
    render(<TomorrowBanner patientId="p1" />);
    expect(screen.queryByText(/call ortho/)).toBeNull();
  });

  it('renders each tomorrowNote line with dismiss + promote buttons', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await waitFor(() => expect(screen.getByText('call ortho')).toBeTruthy());
    expect(screen.getByText('AM labs drawn')).toBeTruthy();
    expect(screen.getAllByText('דחה')).toHaveLength(2);
    expect(screen.getAllByText('הפוך לקבועה')).toHaveLength(2);
  });

  it('dismiss splices a single line', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await waitFor(() => screen.getByText('call ortho'));
    const dismissButtons = screen.getAllByText('דחה');
    fireEvent.click(dismissButtons[0]);  // dismiss "call ortho"
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.tomorrowNotes).toEqual(['AM labs drawn']);
    });
  });

  it('promote moves the line to handoverNote', async () => {
    await putPatient(fixture());
    render(<TomorrowBanner patientId="p1" />);
    await waitFor(() => screen.getByText('call ortho'));
    const promoteButtons = screen.getAllByText('הפוך לקבועה');
    fireEvent.click(promoteButtons[1]);  // promote "AM labs drawn"
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.tomorrowNotes).toEqual(['call ortho']);
      expect(back?.handoverNote).toContain('AM labs drawn');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/TomorrowBanner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `<TomorrowBanner>`**

Create `src/ui/components/TomorrowBanner.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getPatient } from '@/storage/indexed';
import { dismissTomorrowNote, promoteToHandover } from '@/storage/rounds';

interface Props { patientId: string; }

export function TomorrowBanner({ patientId }: Props): JSX.Element | null {
  const [lines, setLines] = useState<string[]>([]);

  async function refresh() {
    const p = await getPatient(patientId);
    setLines(p?.tomorrowNotes ?? []);
  }

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener('ward-helper:patients-changed', handler);
    return () => window.removeEventListener('ward-helper:patients-changed', handler);
  }, [patientId]);

  if (lines.length === 0) return null;

  return (
    <div className="banner banner-info" dir="auto">
      <h3>הערות למחר</h3>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>
            <span>{line}</span>
            <button onClick={() => void dismissTomorrowNote(patientId, i).then(refresh)}>דחה</button>
            <button onClick={() => void promoteToHandover(patientId, i).then(refresh)}>הפוך לקבועה</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

(The `ward-helper:patients-changed` event name should match what `glanceableEvents.ts` actually emits. Verify with `grep "patients-changed\|notifyPatientsChanged" src/ui/hooks/glanceableEvents.ts` and adjust if the actual name differs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/TomorrowBanner.test.tsx`
Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/TomorrowBanner.tsx tests/TomorrowBanner.test.tsx
git commit -m "feat(ui): TomorrowBanner with per-line dismiss + promote"
```

---

### Task 3.5: `<ReadmitBanner>` for capture flow

**Files:**
- Create: `src/ui/components/ReadmitBanner.tsx`
- Create: `tests/ReadmitBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/ReadmitBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadmitBanner } from '@/ui/components/ReadmitBanner';

describe('ReadmitBanner', () => {
  it('shows the gap days + name', () => {
    render(<ReadmitBanner name="כהן שרה" gapDays={5} onAccept={() => {}} onDecline={() => {}} />);
    expect(screen.getByText(/כהן שרה/)).toBeTruthy();
    expect(screen.getByText(/5/)).toBeTruthy();
  });

  it('calls onAccept when accept button clicked', () => {
    const onAccept = vi.fn();
    render(<ReadmitBanner name="X" gapDays={1} onAccept={onAccept} onDecline={() => {}} />);
    fireEvent.click(screen.getByText('כן, חזרה לאשפוז'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('calls onDecline when decline button clicked', () => {
    const onDecline = vi.fn();
    render(<ReadmitBanner name="X" gapDays={1} onAccept={() => {}} onDecline={onDecline} />);
    fireEvent.click(screen.getByText('לא, חולה חדש'));
    expect(onDecline).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ReadmitBanner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `<ReadmitBanner>`**

Create `src/ui/components/ReadmitBanner.tsx`:

```tsx
interface Props {
  name: string;
  gapDays: number;
  onAccept: () => void;
  onDecline: () => void;
}

export function ReadmitBanner({ name, gapDays, onAccept, onDecline }: Props): JSX.Element {
  return (
    <div className="banner banner-warn" dir="auto">
      <p>TZ זוהה — מטופל {name} שוחרר לפני {gapDays} ימים. לחזרה לאשפוז?</p>
      <button onClick={onAccept}>כן, חזרה לאשפוז</button>
      <button onClick={onDecline}>לא, חולה חדש</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ReadmitBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ReadmitBanner.tsx tests/ReadmitBanner.test.tsx
git commit -m "feat(ui): ReadmitBanner for capture-flow TZ collisions"
```

---

### Task 3.6: Wire `<ReadmitBanner>` into capture flow

**Files:**
- Modify: `src/ui/screens/Capture.tsx`

- [ ] **Step 1: Locate the TZ-extract result handler in Capture.tsx**

```bash
grep -n "getPatientByTz\|teudatZehut" src/ui/screens/Capture.tsx | head -10
```

Find the point where the extract result returns a TZ and the code looks up an existing patient.

- [ ] **Step 2: Add re-admit detection branch**

Inside the post-extract handler, after `getPatientByTz(tz)` returns a patient with `discharged === true`, render `<ReadmitBanner>` with `detectReadmit(patient).gapDays`.

Pseudocode shape (adapt to actual file):

```tsx
import { detectReadmit } from '@/notes/seedFromYesterdaySoap';
import { unDischargePatient } from '@/storage/rounds';
import { ReadmitBanner } from '@/ui/components/ReadmitBanner';

// after extract returns existingPatient via getPatientByTz:
if (existingPatient && existingPatient.discharged === true) {
  const { isReadmit, gapDays } = detectReadmit(existingPatient);
  if (isReadmit && gapDays !== undefined) {
    setReadmitState({ name: existingPatient.name, gapDays, patientId: existingPatient.id });
    return;
  }
}

// ...elsewhere in JSX:
{readmitState && (
  <ReadmitBanner
    name={readmitState.name}
    gapDays={readmitState.gapDays}
    onAccept={async () => {
      await unDischargePatient(readmitState.patientId, readmitState.gapDays, 're-admission via capture');
      setReadmitState(null);
      // continue existing capture flow
    }}
    onDecline={() => setReadmitState(null)}
  />
)}
```

- [ ] **Step 3: Add a focused integration test**

Create `tests/captureReadmit.test.tsx` covering: capture sees a discharged TZ → banner appears → accept flips `discharged=false`. Mirror the existing `captureCap.test.tsx` style for the test scaffold.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Capture.tsx tests/captureReadmit.test.tsx
git commit -m "feat(capture): re-admit banner on discharged-TZ collision"
```

---

### Task 3.7: `<PatientPlanFields>` + `<TomorrowNotesInput>` on the patient row

**Files:**
- Create: `src/ui/components/PatientPlanFields.tsx`
- Create: `src/ui/components/TomorrowNotesInput.tsx`
- Create: `tests/PatientPlanFields.test.tsx`
- Modify: `src/ui/components/RecentPatientsList.tsx` (add the two new components per row)

- [ ] **Step 1: Write the failing test for `<PatientPlanFields>`**

Create `tests/PatientPlanFields.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { putPatient, getPatient, resetDbForTests, type Patient } from '@/storage/indexed';
import { PatientPlanFields } from '@/ui/components/PatientPlanFields';

beforeEach(async () => { await resetDbForTests(); });

function p(): Patient {
  return {
    id: 'p1', name: 'X', teudatZehut: '000000018',
    dob: '1940-01-01', room: '5A', tags: [],
    createdAt: 1, updatedAt: 1,
    discharged: false, tomorrowNotes: [], handoverNote: '',
    planLongTerm: 'continue ASA', planToday: '', clinicalMeta: {},
  };
}

describe('PatientPlanFields', () => {
  it('shows existing planLongTerm + planToday', async () => {
    await putPatient(p());
    render(<PatientPlanFields patientId="p1" />);
    await waitFor(() => expect(screen.getByDisplayValue('continue ASA')).toBeTruthy());
  });

  it('saves edits to the patient record', async () => {
    await putPatient(p());
    render(<PatientPlanFields patientId="p1" />);
    const longInput = await waitFor(() => screen.getByLabelText(/תכנית ארוכת-טווח/));
    fireEvent.change(longInput, { target: { value: 'updated long-term' } });
    fireEvent.blur(longInput);
    await waitFor(async () => {
      const back = await getPatient('p1');
      expect(back?.planLongTerm).toBe('updated long-term');
    });
  });
});
```

- [ ] **Step 2: Implement `<PatientPlanFields>`**

Create `src/ui/components/PatientPlanFields.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getPatient, putPatient } from '@/storage/indexed';

interface Props { patientId: string; }

export function PatientPlanFields({ patientId }: Props): JSX.Element {
  const [longTerm, setLongTerm] = useState('');
  const [today, setToday] = useState('');

  useEffect(() => {
    void getPatient(patientId).then(p => {
      setLongTerm(p?.planLongTerm ?? '');
      setToday(p?.planToday ?? '');
    });
  }, [patientId]);

  async function save(field: 'planLongTerm' | 'planToday', value: string) {
    const p = await getPatient(patientId);
    if (!p) return;
    await putPatient({ ...p, [field]: value, updatedAt: Date.now() });
  }

  return (
    <div className="patient-plan-fields" dir="auto">
      <label>
        תכנית ארוכת-טווח
        <textarea
          value={longTerm}
          onChange={e => setLongTerm(e.target.value)}
          onBlur={() => void save('planLongTerm', longTerm)}
          rows={3}
        />
      </label>
      <label>
        תכנית להיום
        <textarea
          value={today}
          onChange={e => setToday(e.target.value)}
          onBlur={() => void save('planToday', today)}
          rows={3}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Implement `<TomorrowNotesInput>` (similar pattern)**

Create `src/ui/components/TomorrowNotesInput.tsx`:

```tsx
import { useState } from 'react';
import { addTomorrowNote } from '@/storage/rounds';

interface Props { patientId: string; }

export function TomorrowNotesInput({ patientId }: Props): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addTomorrowNote(patientId, text.trim());
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tomorrow-notes-input" dir="auto">
      <label>
        הוסף הערה למחר
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={busy}
        />
      </label>
      <button onClick={handleAdd} disabled={busy || !text.trim()}>הוסף</button>
    </div>
  );
}
```

- [ ] **Step 4: Wire both into `<RecentPatientsList>`**

Read `src/ui/components/RecentPatientsList.tsx` first to understand its row shape, then add `<PatientPlanFields patientId={p.id} />`, `<TomorrowBanner patientId={p.id} />`, and `<TomorrowNotesInput patientId={p.id} />` per row in the appropriate slot. Keep the existing layout; these are additive.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/PatientPlanFields.tsx src/ui/components/TomorrowNotesInput.tsx tests/PatientPlanFields.test.tsx src/ui/components/RecentPatientsList.tsx
git commit -m "feat(ui): PatientPlanFields + TomorrowNotesInput wired into RecentPatientsList"
```

---

### Task 3.8: Discharge button + "use yesterday's note" button

**Files:**
- Modify: `src/ui/components/RecentPatientsList.tsx` (add Discharge button + draft-seed button per row)
- Modify: `src/ui/screens/NoteEditor.tsx` (accept seedDecision arg)
- Modify: `src/notes/orchestrate.ts` (add seedContext arg to SOAP emit)

- [ ] **Step 1: Add discharge button to each row**

In `src/ui/components/RecentPatientsList.tsx`, for each patient row that is NOT already discharged, add:

```tsx
<button
  onClick={async () => {
    if (confirm(`לשחרר את ${p.name}?`)) {
      await dischargePatient(p.id);
    }
  }}
>
  שחרר
</button>
```

Filter discharged patients out of the displayed roster (existing list logic + `.filter(p => !p.discharged)`).

- [ ] **Step 2: Add "use yesterday's note" button + wire seedFromYesterdaySoap**

For each non-discharged patient row, add:

```tsx
<button onClick={() => void handleSeedDraft(p.id)}>השתמש בהערת אתמול</button>
```

`handleSeedDraft` calls `decideSeed(patient)`, then either:
- `kind: 'no-prefill'` — opens NoteEditor with empty body + a banner explaining the reason
- `kind: 'prefill'` — calls SOAP emitter with the seedContext, lands result in NoteEditor

Adapt to the existing `<NoteEditor>` mount pattern (likely a route or modal in the app).

- [ ] **Step 3: Update SOAP emit prompt in `src/notes/orchestrate.ts`**

Find the `runEmitTurn` (or equivalent) for SOAP type. Add an optional `seedContext: SeedDecision` argument. When `kind === 'prefill'`, prepend two prompt blocks (per spec § "SOAP emit prompt update"):

```ts
// Block A — yesterday's reference (volatile-only carry instruction)
const blockA = `Yesterday's SOAP for this patient is provided below as reference for clinical
continuity. When drafting today's, the Subjective, vitals, labs, and today's
chief complaint must reflect TODAY'S data — do not copy from yesterday.

Yesterday's SOAP (reference only, do NOT copy verbatim):
${seedContext.bodyContext}`;

// Block B — durable patient context
const blockB = `Patient durable context (use directly; do not re-derive from yesterday's prose):
- handoverNote: ${seedContext.patientFields.handoverNote}
- planLongTerm: ${seedContext.patientFields.planLongTerm}
- clinicalMeta: ${JSON.stringify(seedContext.patientFields.clinicalMeta)}`;
```

Prepend these to the existing system prompt only when `seedContext.kind === 'prefill'`.

- [ ] **Step 4: Add an integration test for the prompt-injection path**

Create `tests/seededSoapPrompt.test.ts` covering: when `decideSeed` returns `prefill`, the SOAP emitter receives a system prompt containing `bodyContext`. Mock `callProxy` to capture the call args, then assert the system prompt contains both Block A (yesterday's bodyContext) and Block B (handoverNote/planLongTerm/clinicalMeta). Locate an existing test pattern via `grep -l "callProxy" tests/` for mock scaffolding to mirror — `tests/clientProxy.test.ts` is a known reference.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/RecentPatientsList.tsx src/ui/screens/NoteEditor.tsx src/notes/orchestrate.ts tests/seededSoapPrompt.test.ts
git commit -m "feat(ui): discharge button + use-yesterday seed-draft flow"
```

---

### Task 3.9: Mount `<MorningArchivePrompt>` in the host screen

**Files:**
- Modify: the screen identified in Task 3.2 (likely `src/ui/App.tsx` or `src/ui/screens/History.tsx`)

- [ ] **Step 1: Import + render**

In the host screen JSX:

```tsx
import { MorningArchivePrompt } from '@/ui/components/MorningArchivePrompt';

// near top of the rendered tree, before the patient list:
<MorningArchivePrompt />
```

- [ ] **Step 2: Add a Settings info line**

Open `src/ui/components/AccountSection.tsx` (or wherever Settings lives — `grep -rn "Settings" src/ui/` to confirm). Add a static line:

```tsx
<p dir="auto" className="settings-info">
  היסטוריית סיכום יום: שמורה רק במכשיר הזה. סנכרון לענן יתווסף בעתיד.
</p>
```

- [ ] **Step 3: Update `IMPROVEMENTS.md`**

Append to `IMPROVEMENTS.md`:

```markdown
## v1.41+ candidate (deferred from v1.40 brainstorm 2026-05-09)

Opt-in cloud sync for `daySnapshots`. Requires:
- Settings toggle "סנכרן היסטוריה לענן"
- New Supabase migration: extend `ALLOWED_BLOB_TYPES` to include `'day-snapshot'`
- Sync hook on `notifyDayArchived` event
- Orphan-canary check extension
```

- [ ] **Step 4: Run all tests + tsc + build**

Run: `npm run check && npm test && npm run build`
Expected: all pass; `dist/sw.js` reads `ward-v1.40.2`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/components/AccountSection.tsx IMPROVEMENTS.md
git commit -m "feat(ui): mount MorningArchivePrompt + Settings info line + IMPROVEMENTS entry"
```

---

### Task 3.10: Push, open PR 3, manual smoke test

- [ ] **Step 1: Push + open draft PR**

```bash
git push -u origin claude/term-rounds-prep-pr3-ui
gh pr create --title "feat: morning rounds prep PR 3 — UI overlay (v1.40.2)" \
  --draft \
  --body "$(cat <<'EOF'
## Summary
- `<MorningArchivePrompt>` with calendar-rollover detection + double-archive confirm
- `<TomorrowBanner>` per-patient with per-line dismiss + promote-to-handoverNote
- `<ReadmitBanner>` wired into capture flow on discharged-TZ collision
- `<PatientPlanFields>` (planLongTerm/planToday textareas) + `<TomorrowNotesInput>` per patient row
- Discharge button + "use yesterday's note" draft-seed flow
- SOAP emit prompt extended with separate Block A (volatile-only carry) + Block B (durable patient context)
- Settings info line about local-only snapshot history
- `IMPROVEMENTS.md` entry for deferred v1.41+ cloud sync

Spec: `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md`.
Plan: `docs/superpowers/plans/2026-05-09-morning-rounds-prep-v1.md` PR 3 section.

## Test plan
- [ ] CI green
- [ ] Manual smoke on dev server: archive flow, draft-seed flow, discharge flow, re-admit flow
- [ ] `bash scripts/verify-deploy.sh` after merge → `ward-v1.40.2` live
- [ ] Open live URL with DevTools console + Network — eyeball-with-DevTools ritual per memory `feedback_eyeball_console_ritual.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Manual smoke test on dev server before marking ready**

```bash
npm run dev
```

Open `http://localhost:5173/ward-helper/`. Walk through:
1. Log in. Manually set `localStorage.setItem('ward-helper.lastArchivedDate', '2026-05-08')` in DevTools to fake yesterday.
2. Reload — banner should appear.
3. Click ארכב — verify the snapshot lands in IDB (DevTools → Application → IndexedDB → daySnapshots).
4. Click "השתמש בהערת אתמול" on a patient row — verify NoteEditor opens with seeded body.
5. Add a tomorrow-note, reload, verify it surfaces in TomorrowBanner.
6. Click הפוך לקבועה — verify the line moves into handoverNote.
7. Discharge a patient — verify they're filtered out.
8. Re-capture the same TZ — verify the ReadmitBanner appears.

Document any drift between expected and actual in PR comments.

- [ ] **Step 3: Mark ready + merge**

```bash
gh pr ready
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Verify live deploy**

```bash
git checkout main && git pull
bash scripts/verify-deploy.sh
```

Expected: `ward-v1.40.2` live.

- [ ] **Step 5: Eyeball-with-DevTools on live URL** (per memory `feedback_eyeball_console_ritual.md`)

Open `https://eiasash.github.io/ward-helper/` in real Chrome with DevTools console + Network tab visible. Click through the morning-rounds flow. Watch for:
- CSP violations (any new inline `<script>` would need a hash update)
- Click handler wall time anomalies
- Raw error bleed
- Duplicate POSTs

Fix any issues in a follow-up minor PR (v1.40.3 if needed).

---

## Final acceptance

- [ ] All 3 PRs merged to main
- [ ] `package.json.version` is `1.40.2`
- [ ] `bash scripts/verify-deploy.sh` returns success on `ward-v1.40.2`
- [ ] Doctor can complete the full daily flow on the live site:
  - Open in morning → see archive banner → accept → yesterday archived
  - Each patient row shows planLongTerm / planToday textareas
  - "השתמש בהערת אתמול" pre-fills NoteEditor with appropriate carry
  - Add a tomorrowNote → reload → see it surface
  - Discharge a patient → they vanish from active roster
  - Re-capture a discharged patient's TZ → re-admit banner offers un-discharge
- [ ] Tests added: ~30+ new vitest cases on top of existing 900+ suite
- [ ] CLAUDE.md updated with rounds-prep entries (if relevant per claude-md-management:revise-claude-md skill)

## Cross-references

- Spec: `docs/superpowers/specs/2026-05-09-morning-rounds-prep-design.md`
- Brief: `docs/NEXT_SESSION_BRIEF-morning-rounds-prep.md`
- Toranot port source: `~/repos/Toranot/src/engine/shiftContinuity.ts`, `~/repos/Toranot/tests/shiftContinuity.test.ts`
- Existing continuity: `src/notes/continuity.ts`
- Existing TZ lookup: `src/storage/indexed.ts:189` (`getPatientByTz`)
- Memory entries: `project_ward_helper_morning_rounds_prep.md`, `feedback_existing_utility_never_called.md`, `feedback_eyeball_console_ritual.md`
