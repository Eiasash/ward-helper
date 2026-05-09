import { getDb, listPatients, putPatient } from './indexed';
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
 * snapshot (Q5b), enforced by `putDaySnapshot`'s upsert-on-id semantics.
 *
 * Sets `localStorage.LAST_ARCHIVED_KEY = today` and dispatches
 * `ward-helper:day-archived` after persistence completes.
 *
 * Errors from `putPatient` propagate upward — the snapshot has already been
 * written by then, so the user can re-run safely.
 */
export async function archiveDay(): Promise<DaySnapshot> {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const archivedAt = Date.now();
  const patients = await listPatients();

  // Frozen copy — capture planToday BEFORE clearing.
  const snapshot: DaySnapshot = {
    id: today,
    date: today,
    archivedAt,
    patients: patients.map((p) => ({ ...p })), // shallow clone
  };
  await putDaySnapshot(snapshot);

  // Clear planToday for all live patients (skip rows already empty).
  for (const p of patients) {
    if (p.planToday !== '') {
      await putPatient({ ...p, planToday: '', updatedAt: archivedAt });
    }
  }

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
