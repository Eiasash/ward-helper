import { getDb } from './indexed';
import type { Patient } from './indexed';
import { notifyDayArchived } from '@/ui/hooks/glanceableEvents';

export const SNAPSHOT_HISTORY_CAP = 20;

export interface DaySnapshot {
  id: string; // YYYY-MM-DD; primary key
  date: string; // duplicates id for clarity
  archivedAt: number; // ms timestamp
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

export const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

/**
 * Archive today's roster: snapshot the current `patients` table into
 * `daySnapshots` keyed by today's date (YYYY-MM-DD), then clear `planToday`
 * on every live patient. The snapshot freezes `planToday` BEFORE the clear so
 * yesterday's plans are recoverable. Same-date re-archive replaces the prior
 * snapshot (Q5b), enforced by upsert-on-id semantics.
 *
 * Atomicity: the snapshot put + per-patient clears all run inside a single
 * multi-store IDB transaction (`daySnapshots` + `patients`, readwrite). If
 * any operation fails, the entire transaction aborts — neither the snapshot
 * nor the clears persist, so re-running is genuinely safe (cf. the original
 * bug where a partial clear with a persisted snapshot could be overwritten
 * with corrupted data on retry).
 *
 * Sets `localStorage.LAST_ARCHIVED_KEY = today` and dispatches
 * `ward-helper:day-archived` after the tx commits.
 */
export async function archiveDay(): Promise<DaySnapshot> {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const archivedAt = Date.now();
  const db = await getDb();

  const tx = db.transaction(['daySnapshots', 'patients'], 'readwrite');
  const snapshotsStore = tx.objectStore('daySnapshots');
  const patientsStore = tx.objectStore('patients');

  // Read live patients within the same tx (consistency).
  const patients = (await patientsStore.getAll()) as Patient[];

  // Frozen copy — capture planToday BEFORE clearing. structuredClone
  // isolates the returned snapshot from any future caller mutation
  // (ward-helper targets es2022, which has structuredClone in all
  // supported runtimes including the test env).
  const snapshot: DaySnapshot = {
    id: today,
    date: today,
    archivedAt,
    patients: structuredClone(patients),
  };

  // Snapshot write + cap (mirrors putDaySnapshot's logic, inlined so the
  // whole archive runs inside one tx — calling putDaySnapshot here would
  // open a second tx and break atomicity).
  await snapshotsStore.put(snapshot);
  const allSnaps = (await snapshotsStore.getAll()) as DaySnapshot[];
  if (allSnaps.length > SNAPSHOT_HISTORY_CAP) {
    const sorted = [...allSnaps].sort((a, b) => a.archivedAt - b.archivedAt);
    const toDelete = sorted.slice(0, allSnaps.length - SNAPSHOT_HISTORY_CAP);
    for (const s of toDelete) await snapshotsStore.delete(s.id);
  }

  // Clear planToday for all live patients (skip rows already empty).
  for (const p of patients) {
    if (p.planToday !== '') {
      await patientsStore.put({ ...p, planToday: '', updatedAt: archivedAt });
    }
  }

  await tx.done;

  localStorage.setItem(LAST_ARCHIVED_KEY, today);
  notifyDayArchived();
  return snapshot;
}

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
