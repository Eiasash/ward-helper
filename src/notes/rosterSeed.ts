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
import type { ParseFields } from '@/agent/tools';
import type { RosterPatient } from '@/storage/roster';

const STORAGE_KEY = 'rosterSeed';

/**
 * Read + parse + clear sessionStorage's rosterSeed and apply it to
 * extract output. Returns extract unchanged when no seed (or bad seed)
 * is present. Always clears the storage entry so a back-and-forth
 * navigation doesn't double-apply or leak across patients.
 */
export function applyRosterSeedFromStorage(extract: ParseFields): ParseFields {
  let seedRaw: string | null;
  try {
    seedRaw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage may throw in private/quota-exceeded contexts;
    // degrade silently to extract-as-is.
    return extract;
  }
  if (!seedRaw) return extract;
  // Clear FIRST so a malformed JSON below also gets removed —
  // stale bad-JSON would block the merge for every subsequent extract.
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — same posture as the read */
  }
  try {
    const seed = JSON.parse(seedRaw) as RosterPatient;
    return mergeRosterIdentity(seed, extract);
  } catch {
    // Bad JSON in storage — fall through with extract as-is.
    return extract;
  }
}
