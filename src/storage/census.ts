/**
 * Census ingestion — turn extracted AZMA grid rows into Patient stub
 * upserts in IDB.
 *
 * Contract:
 *   - Census records do NOT round-trip through the Note store. They
 *     produce patient-stub upserts and nothing else. Census is
 *     situational awareness, not a clinical note.
 *   - If a patient with the same teudatZehut already exists, update
 *     room + tags only. Do NOT overwrite the existing name — the user
 *     may have edited a typo'd OCR pass earlier; the census shouldn't
 *     re-corrupt it.
 *   - If teudatZehut is null, skip the row (cannot dedupe without ID).
 *   - All work is one IDB tx implicit per put — no batching needed at
 *     this volume (a ward has 20-40 patients).
 */

import {
  listPatients,
  putPatient,
  type Patient,
} from './indexed';
import type { CensusRow } from '@/agent/loop';

export interface CensusUpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Convert the boolean/color flags on a census row to readable tags so
 * the existing patient-card UI surfaces them without a schema change.
 */
function rowToTags(row: CensusRow): string[] {
  const tags: string[] = [];
  if (row.isolation) tags.push('isolation');
  if (row.ventilation) tags.push('ventilation');
  if (row.bloodBankColor) tags.push(`blood-bank:${row.bloodBankColor}`);
  if (row.unsignedAdmission) tags.push('unsigned-admission');
  if (row.unsignedShiftSummary) tags.push('unsigned-shift-summary');
  return tags;
}

export async function upsertCensus(rows: CensusRow[]): Promise<CensusUpsertResult> {
  const existing = await listPatients();
  const byTz = new Map<string, Patient>();
  for (const p of existing) {
    if (p.teudatZehut) byTz.set(p.teudatZehut, p);
  }

  const now = Date.now();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.teudatZehut) {
      skipped++;
      continue;
    }
    const tz = row.teudatZehut.trim();
    if (!tz) {
      skipped++;
      continue;
    }
    const existingP = byTz.get(tz);
    if (existingP) {
      // Update room + tags only — preserve name. Tags are merged so the
      // census doesn't drop hand-added tags from earlier admissions.
      const mergedTags = Array.from(new Set([...existingP.tags, ...rowToTags(row)]));
      await putPatient({
        ...existingP,
        room: row.room || existingP.room,
        tags: mergedTags,
        updatedAt: now,
      });
      updated++;
    } else {
      await putPatient({
        id: crypto.randomUUID(),
        name: row.name,
        teudatZehut: tz,
        dob: '',
        room: row.room || null,
        tags: rowToTags(row),
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}
