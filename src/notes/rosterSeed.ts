/**
 * Single-patient roster seed wiring.
 *
 * When the doctor taps the "+ SOAP" button on a roster card in
 * Today.tsx, `startSoapForRosterPatient` stashes the full
 * RosterPatient as a JSON-stringified `rosterSeed` value in
 * sessionStorage. Review.tsx reads the seed AFTER its extract turn
 * resolves and merges roster identity into the extract output —
 * roster wins on identity (high-confidence from import-modal preview),
 * extract wins on clinical (vitals, meds, labs).
 *
 * This is the single-patient mirror of the batch driver's
 * mergeRosterIdentity call — same merge function, different surface.
 * Without this wiring the doctor would have to re-photograph the
 * patient card on every roster→SOAP click; with it, only clinical
 * content needs to be in the captured images.
 *
 * One-shot semantics: the seed is cleared after read so a back-then-
 * forward re-extract on a different patient doesn't leak the prior
 * identity. Bad JSON is also cleared and the helper returns extract
 * unchanged — defensive against manual storage tampering or stale
 * schema versions.
 */

import { mergeRosterIdentity } from './batchSoap';
import type { ParseFields, Confidence } from '@/agent/tools';
import type { RosterPatient } from '@/storage/roster';

const STORAGE_KEY = 'rosterSeed';

/** Identity fields the roster contributes — these get high confidence when seeded. */
const ROSTER_IDENTITY_KEYS = ['name', 'teudatZehut', 'age', 'sex', 'room'] as const;

/**
 * Read + parse + clear sessionStorage's rosterSeed and apply it to
 * extract output. Returns extract unchanged when no seed (or bad seed)
 * is present. Always clears the storage entry so a back-and-forth
 * navigation doesn't double-apply or leak across patients.
 *
 * Backward-compatible wrapper around applyRosterSeedFromStorageWithConfidence.
 * Existing callers that don't need confidence overrides still work; new
 * callers (Review.tsx) should use the *WithConfidence variant so identity
 * fields populated from the roster aren't flagged as "אישור ידני נדרש".
 */
export function applyRosterSeedFromStorage(extract: ParseFields): ParseFields {
  return applyRosterSeedFromStorageWithConfidence(extract, {}).fields;
}

/**
 * Like applyRosterSeedFromStorage, but ALSO returns confidence overrides
 * for fields populated from the roster.
 *
 * Roster identity is doctor-curated in the import-modal preview before
 * setRoster lands — it deserves 'high' confidence. Without this, Review.tsx's
 * FieldRow sees `confidence === undefined && critical=true` and renders
 * "אישור ידני נדרש" on every roster-sourced identity field, forcing the
 * doctor to manually re-confirm name/tz/age that they already imported.
 *
 * Mega-bot 2026-05-10 + user direct report 2026-05-10 confirmed this is
 * the SOAP "re-prompt for ID" bug.
 */
export function applyRosterSeedFromStorageWithConfidence(
  extract: ParseFields,
  baseConfidence: Record<string, Confidence>,
): { fields: ParseFields; confidence: Record<string, Confidence> } {
  let seedRaw: string | null;
  try {
    seedRaw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage may throw in private/quota-exceeded contexts;
    // degrade silently to extract-as-is.
    return { fields: extract, confidence: baseConfidence };
  }
  if (!seedRaw) return { fields: extract, confidence: baseConfidence };
  // Clear FIRST so a malformed JSON below also gets removed —
  // stale bad-JSON would block the merge for every subsequent extract.
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — same posture as the read */
  }
  try {
    const seed = JSON.parse(seedRaw) as RosterPatient;
    const fields = mergeRosterIdentity(seed, extract);
    // For each identity key the seed actually contributed, override
    // confidence to 'high'. Skip keys where the seed value is null/undefined
    // — those didn't get filled by the roster, so extract's confidence stands.
    const confidence: Record<string, Confidence> = { ...baseConfidence };
    if (seed.name) confidence['name'] = 'high';
    if (seed.tz) confidence['teudatZehut'] = 'high';
    if (seed.age != null) confidence['age'] = 'high';
    if (seed.sex) confidence['sex'] = 'high';
    if (seed.room) confidence['room'] = 'high';
    return { fields, confidence };
  } catch {
    // Bad JSON in storage — fall through with extract as-is.
    return { fields: extract, confidence: baseConfidence };
  }
}

// Suppress unused-import warning when the readonly tuple is only referenced
// in JSDoc above. Touching it via Object.keys keeps the type live.
void ROSTER_IDENTITY_KEYS;
