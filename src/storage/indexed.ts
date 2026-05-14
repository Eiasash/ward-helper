import { openDB, type IDBPDatabase } from 'idb';

import type { SafetyFlags } from '@/safety/types';
import { notifyNotesChanged } from '@/ui/hooks/glanceableEvents';
import {
  decryptRowIfEncrypted,
  decryptRowsIfEncrypted,
  isEncryptedRow,
  type SealedNoteRow,
  type SealedPatientRow,
} from '@/crypto/phiRow';

export type NoteType = 'admission' | 'discharge' | 'consult' | 'case' | 'soap' | 'census';

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

export interface Note {
  id: string;
  patientId: string;
  type: NoteType;
  bodyHebrew: string;
  structuredData: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /**
   * Timestamp (ms) when the user copied this note to the Chameleon clipboard.
   * Optional + nullable: old rows written under schema v2 have the field
   * absent → reads back as undefined, which the UI treats as "not sent".
   * A one-time backfill to `null` would be a needless IDB rewrite on every
   * existing note.
   */
  sentToEmrAt?: number | null;
  /**
   * Drug-safety hits computed at extract time and frozen with the note.
   * Optional + non-indexed: old rows have it absent, new rows carry the
   * snapshot the doctor saw when generating the note. We snapshot rather
   * than recompute on read because the rule set itself versions; a rerun
   * months later under new rules would silently change the displayed
   * hits without the doctor having re-reviewed.
   */
  safetyFlags?: SafetyFlags;
}

export interface CachedUnlockBlob {
  v: 1;
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export interface Settings {
  apiKeyXor: Uint8Array<ArrayBuffer>;
  deviceSecret: Uint8Array<ArrayBuffer>;
  lastPassphraseAuthAt: number | null;
  prefs: Record<string, unknown>;
  /**
   * Backup passphrase encrypted with PBKDF2(loginPassword)-derived AES key.
   * v1.34.x history; unused as of v1.35.0 but kept on the type for forward/
   * backward compat — see useSettings.ts.
   */
  cachedUnlockBlob?: CachedUnlockBlob | null;
  /**
   * v1.35.2: login password XOR-obfuscated with deviceSecret, persisted in
   * IDB so cloud-backup keeps working across page reloads. Threat model
   * matches apiKeyXor — protects against casual IDB inspection / backup
   * sweeps but a determined attacker with same-profile devtools recovers
   * it. Necessary because v1.35.0 made the login password the cloud key,
   * and prior to v1.35.2 it lived in JS memory only — every reload broke
   * cloud backup until the user logged out + back in.
   */
  loginPwdXor?: Uint8Array<ArrayBuffer> | null;
  /**
   * 16-byte salt for PHI-at-rest PBKDF2 derivation. Generated once on
   * first install via src/crypto/phi.ts::loadOrCreatePhiSalt, then STABLE
   * for the life of the install — regenerating would orphan every existing
   * ciphertext row. Non-secret (an attacker with the salt still needs the
   * login password to derive the key), but never rewritten once present.
   *
   * PR-A only persists this; the encrypt/decrypt callers ship in PR-B.
   */
  phiSalt?: Uint8Array<ArrayBuffer> | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

// --- Schema migrations -----------------------------------------------------
// Bump DB_VERSION when adding stores or indexes. The `upgrade` callback gets
// the `oldVersion` param so you can run incremental migrations (e.g. add a
// by-teudatZehut index in v2, add a costsPerNote store in v3, etc).
//
// IMPORTANT: `upgrade` runs blocking. Keep it cheap — no async work, no large
// loops. If you need to migrate data, use a cursor and batch; don't
// getAll()/putAll() in one go on a user who has 500 notes.
//
// Current schema (v4):
//   patients [keyPath: id]
//   notes    [keyPath: id, index: by-patient (patientId), by-tz (teudatZehut)]
//   settings [no keyPath, uses string keys ('singleton')]
//
// The by-tz index was added in v2 to make listNotesByTeudatZehut O(1)
// instead of O(N_patients) on every SOAP continuity resolve.
//
// v3 introduces Note.sentToEmrAt (optional, non-indexed). The object store
// doesn't change — IDB stores free-form objects, so a new optional field
// needs no schema work. We still bump DB_VERSION: it documents that the
// Note shape changed, future indexes on sentToEmrAt branch off v3, and
// any data-migration for old notes would land in the v3 upgrade block.
//
// v4 adds Note.safetyFlags (optional SafetyFlags from src/safety). Same
// shape contract as sentToEmrAt — no migration, no index, just a
// version bump so future safety-flag queries have a place to land.
//
// v5 (Phase D, v1.38.0): adds a `roster` object store for the daily
// department snapshot — separate from `patients` because roster rows
// are ephemeral (24h TTL via ageOutRoster on boot) and are NOT cloud-
// backed. Schema invariants live in src/storage/roster.ts. No indexes
// — daily roster is bounded at <50 rows, full scan is cheaper than
// a B-tree lookup on a dataset that small.
//
// v7 (PR-B1, 2026-05-14): drops the patients.by-tz index. Preparing
// for PR-B2's PHI-at-rest encryption layer — once Patient row values
// are encrypted, the IDB index can no longer key on plaintext tz, and
// a hashed-index alternative would leak the SET of tz hashes via a
// cloud backup (defeating the password-derived-key threat model). The
// three storage-layer functions that used by-tz (getPatientByTz,
// upsertPatientByTz, listNotesByTeudatZehut) now scan-and-filter on
// the full patients list. Latency math (PR-A grounding pass): scan
// cost is ~30-100ms at ward scale (50-100 patients), inside existing
// budgets on every site except Census's per-row loop, which is
// addressed by the new listPatientsByTzMap helper.
//
// Note: B1 ships this against PLAINTEXT data. PR-B2 layers encryption
// on top via the localStorage.phi_encrypt_v7 flag. By shipping the
// schema change separately first, "scan-based lookup works" is proven
// in production before any encryption complexity layers on.
const DB_VERSION = 7;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('ward-helper', DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // v1: initial schema
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('patients')) {
            db.createObjectStore('patients', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('notes')) {
            const notes = db.createObjectStore('notes', { keyPath: 'id' });
            notes.createIndex('by-patient', 'patientId');
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
          }
        }
        // v2: add by-teudatZehut index on patients using the EXISTING
        // versionchange transaction. Opening a new tx inside upgrade()
        // aborts the migration — fake-indexeddb surfaces this as an
        // AbortError (real browsers silently succeed in some cases but
        // the fake IDB is correct).
        if (oldVersion < 2) {
          const patients = tx.objectStore('patients');
          if (!patients.indexNames.contains('by-tz')) {
            patients.createIndex('by-tz', 'teudatZehut', { unique: false });
          }
        }
        if (oldVersion < 3) {
          // Schema unchanged — Note.sentToEmrAt is an optional non-indexed
          // field. Block kept intentionally so future v3 data migrations
          // (backfills, index adds on sentToEmrAt) have a landing spot.
        }
        if (oldVersion < 4) {
          // Schema unchanged — Note.safetyFlags is an optional non-indexed
          // field. Block kept intentionally so future v4 data migrations
          // (backfills, rule-version stamping) have a landing spot.
        }
        if (oldVersion < 5) {
          // Phase D (v1.38.0): department roster store — daily snapshot,
          // 24h TTL, no cloud backup, no indexes (bounded <50 rows).
          if (!db.objectStoreNames.contains('roster')) {
            db.createObjectStore('roster', { keyPath: 'id' });
          }
        }
        if (oldVersion < 6) {
          // v1.40.0: rounds-prep daySnapshots store. Keyed by date YYYY-MM-DD;
          // upserts replace prior snapshot for same date (Q5b confirm-allow-replace).
          // No data backfill here — that runs post-open via runV1_40_0_BackfillIfNeeded
          // (idb upgrade callback transaction lifetime is finicky; spec § decisions Q5c).
          if (!db.objectStoreNames.contains('daySnapshots')) {
            db.createObjectStore('daySnapshots', { keyPath: 'id' });
          }
        }
        if (oldVersion < 7) {
          // PR-B1 (2026-05-14): drop the patients.by-tz index. PR-B2 will
          // add encrypted-row shape on top, at which point a plaintext-tz
          // index would either be useless (encrypted rows) or leaky (hashed).
          // Pre-emptive drop now lets B1 prove the scan-based caller
          // refactor in production before B2 layers encryption.
          //
          // Ordering note: this block runs AFTER v2's by-tz createIndex
          // when migrating a v1 install — the chain v1 → v2 → ... → v7
          // creates the index then drops it, which is wasted-but-correct.
          // For a v6 install (the common case in May 2026), v2 already
          // ran historically; only this block fires.
          //
          // Idempotency guard: deleting a missing index throws
          // InvalidStateError, so check `indexNames.contains` first.
          const patientsForV7 = tx.objectStore('patients');
          if (patientsForV7.indexNames.contains('by-tz')) {
            patientsForV7.deleteIndex('by-tz');
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* connection already closed — fine */
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    // onblocked: fake-indexeddb can fire this spuriously. Rejecting would
    // deadlock the suite; in a real browser a blocked delete indicates a
    // leaked connection and would warrant escalation.
    req.onblocked = () => resolve();
  });
}

export async function putPatient(p: Patient): Promise<void> {
  await (await getDb()).put('patients', p);
}

/**
 * Resolve a patient by teudatZehut and persist the row.
 *
 * Looks up the by-tz index first: if a patient with this ת.ז. already
 * exists, the new fields are MERGED onto the existing row (preserving
 * id + createdAt), so a second admission for the same person doesn't
 * fork into a duplicate. Without tz to key on, a fresh id is minted —
 * there's nothing to dedupe against.
 *
 * Merge semantics on a match: a new value wins only when it's actually
 * present (non-empty string / non-null / non-empty array). A blank
 * field on a follow-up save (sparse extract — OCR couldn't read the
 * patient card this time) preserves whatever was on the existing row.
 * Tags are unioned so accumulated isolation/ventilation flags from the
 * census parser survive a subsequent note-save with empty tags.
 *
 * Stored teudatZehut is always the trimmed form. Without normalization
 * on write, "  123456789  " gets indexed as the trimmed value but
 * stored with whitespace; subsequent lookups (which trim first) miss
 * the row and re-mint a duplicate id — splitting the patient across
 * two rows with the same effective ID.
 *
 * Returns the row that was actually written so callers (saveBoth) can
 * encrypt the same shape they persisted locally — without a second IDB
 * read to reconstruct it.
 */
/**
 * Look up a patient by teudatZehut without writing. Returns the most-recently
 * updated match, or null if none. Trims the input — without normalization
 * the by-tz index miss-splits the same patient across two rows.
 *
 * Used by /census v1.39.15 augmentation: when extract returns a row with
 * a TZ but empty name (the model is being conservative about Hebrew names
 * on paper handover sheets), look up the existing patient and pre-fill
 * the name from local state.
 */
export async function getPatientByTz(tz: string): Promise<Patient | null> {
  const trimmed = tz.trim();
  if (!trimmed) return null;
  // v7+: by-tz index dropped; full-scan + JS filter. At ward scale
  // (50-100 patients) one scan costs ~30ms on a phone, inside the
  // budget of every caller (Review/Census/continuity/PriorNotesBanner).
  // Census loops over rows and should use listPatientsByTzMap below
  // instead of calling this function per-row.
  const all = await listPatients();
  const matches = all.filter((p) => p.teudatZehut === trimmed);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  return matches[0]!;
}

/**
 * One-shot map of patients keyed by trimmed teudatZehut. Used by Census
 * import which iterates census rows and looks up each tz — pre-v7 that
 * was N × index lookups (O(N) total); post-v7 without this helper it
 * would be N × full-scan (O(N²)). The helper collapses it to O(N) total
 * by paying the scan cost once.
 *
 * Patients with a blank tz are silently skipped — they have no key for
 * the map and per-row callers fall back to mint-new behavior.
 * Duplicates (rare; would represent a prior index-bug or manual import
 * corruption) resolve to the most-recently-updated row, matching
 * getPatientByTz's contract.
 */
export async function listPatientsByTzMap(): Promise<Map<string, Patient>> {
  const all = await listPatients();
  // Sort first so the LAST entry written to the Map for a given tz
  // is the most-recently-updated one (Map.set replaces). Ascending
  // sort means the newest patient lands on top of any duplicate older
  // ones at the same key.
  all.sort((a, b) => a.updatedAt - b.updatedAt);
  const out = new Map<string, Patient>();
  for (const p of all) {
    const tz = p.teudatZehut?.trim();
    if (!tz) continue;
    out.set(tz, p);
  }
  return out;
}

export async function upsertPatientByTz(p: Omit<Patient, 'id'>): Promise<Patient> {
  const tz = p.teudatZehut.trim();
  if (!tz) {
    const row: Patient = { ...p, id: crypto.randomUUID(), teudatZehut: tz };
    await putPatient(row);
    return row;
  }
  // v7+: by-tz index dropped; scan + JS filter. Called once per
  // patient-save (saveBoth in src/notes/save.ts), not in a hot loop.
  const all = await listPatients();
  const matches = all.filter((x) => x.teudatZehut === tz);
  if (matches.length > 0) {
    matches.sort((a, b) => b.updatedAt - a.updatedAt);
    const existing = matches[0]!;
    const row: Patient = {
      id: existing.id,
      name: p.name || existing.name,
      teudatZehut: tz,
      dob: p.dob || existing.dob,
      room: p.room || existing.room,
      tags: Array.from(new Set([...existing.tags, ...p.tags])),
      createdAt: existing.createdAt,
      updatedAt: p.updatedAt,
    };
    await putPatient(row);
    return row;
  }
  const row: Patient = { ...p, id: crypto.randomUUID(), teudatZehut: tz };
  await putPatient(row);
  return row;
}

export async function listPatients(): Promise<Patient[]> {
  // PR-B2.1: route through the read seam. Under flag-off + no encrypted
  // rows (B2.1's world) the helper's fast path returns the raw array
  // unchanged (byte-equal to today). Under flag-on (B2.2's world) any
  // encrypted-shape rows decrypt here; that's the seam.
  const rows = (await (await getDb()).getAll('patients')) as Array<
    Patient | SealedPatientRow
  >;
  return decryptRowsIfEncrypted<Patient>(rows, 'patient');
}

export async function putNote(n: Note): Promise<void> {
  await (await getDb()).put('notes', n);
}

export async function listNotes(patientId: string): Promise<Note[]> {
  const db = await getDb();
  // PR-B2.1: by-patient index keys on patientId (plaintext, non-PII, kept
  // at row top-level even on the post-B2.2 encrypted SealedNoteRow shape).
  // The index lookup itself doesn't need to change; only the row values
  // returned from it pass through the decryption seam.
  const rows = (await db.getAllFromIndex('notes', 'by-patient', patientId)) as Array<
    Note | SealedNoteRow
  >;
  return decryptRowsIfEncrypted<Note>(rows, 'note');
}

/**
 * One-shot fetch of every note in the DB. Used by History to group into a
 * patient→notes map for render + search without N per-patient round-trips.
 * The dataset is bounded (hundreds of notes max in real use) — a single
 * getAll is strictly cheaper than N index scans.
 */
export async function listAllNotes(): Promise<Note[]> {
  // PR-B2.1: cross the read seam (see listPatients for rationale).
  const rows = (await (await getDb()).getAll('notes')) as Array<Note | SealedNoteRow>;
  return decryptRowsIfEncrypted<Note>(rows, 'note');
}

export async function getNote(id: string): Promise<Note | undefined> {
  // PR-B2.1: point read through the seam. Decrypt-failure null is coerced
  // to undefined to preserve the existing call-site signature (callers
  // already handle `undefined` as "not found"). B2.2 will add the visible
  // "1 record couldn't be loaded" UX affordance for the null branch.
  const raw = (await (await getDb()).get('notes', id)) as Note | SealedNoteRow | undefined;
  const result = await decryptRowIfEncrypted<Note>(raw, 'note');
  return result ?? undefined;
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  // PR-B2.1: point read through the seam. Same null→undefined coercion
  // rationale as getNote above.
  const raw = (await (await getDb()).get('patients', id)) as
    | Patient
    | SealedPatientRow
    | undefined;
  const result = await decryptRowIfEncrypted<Patient>(raw, 'patient');
  return result ?? undefined;
}

export async function deleteNote(id: string): Promise<void> {
  await (await getDb()).delete('notes', id);
}

/**
 * Mark a note as copied to the Chameleon clipboard. Bumps both sentToEmrAt
 * and updatedAt — the copy is an interaction with the note and History
 * sorts by updatedAt, so just-sent notes float to the top naturally.
 * Missing-note is a silent no-op (the user may have deleted the note
 * mid-copy on another tab).
 */
export async function markNoteSent(id: string, ts: number = Date.now()): Promise<void> {
  const db = await getDb();
  // PR-B2.1: sync-sniff-inside-tx pattern. Under flag-off + no encrypted
  // rows (B2.1's world), this is a no-op gate — sniff returns false,
  // plaintext fast path runs identical to today. Under a premature flag-on
  // (encrypted row in storage before B2.2's full staged-write lands at
  // this site), throw an explicit error rather than corrupting the row
  // by writing a plaintext-shaped mutation back over an encrypted row.
  // B2.2 will replace this throw with the staged write pattern.
  const raw = (await db.get('notes', id)) as Note | SealedNoteRow | undefined;
  if (!raw) return;
  if (isEncryptedRow(raw)) {
    throw new Error(
      'markNoteSent: encountered encrypted note row but B2.2 staged-write pattern not yet wired at this site',
    );
  }
  const note = raw;
  await db.put('notes', { ...note, sentToEmrAt: ts, updatedAt: ts });
  // Header-strip pending-sync subscribes — drop the count by 1 immediately.
  // `glanceableEvents` is a tiny no-dep module (just `window.dispatchEvent`)
  // so the storage layer can statically import it without pulling in the
  // hook module that itself depends on storage. Avoids the Vite mixed
  // static/dynamic-import warning.
  notifyNotesChanged();
}

export async function setSettings(s: Settings): Promise<void> {
  await (await getDb()).put('settings', s, 'singleton');
}

export async function getSettings(): Promise<Settings | undefined> {
  return (await getDb()).get('settings', 'singleton');
}

/**
 * Field-safe partial update of the singleton Settings record.
 *
 * Reads the current settings (or a fresh defaults record on first-write),
 * spreads the partial on top, and writes the result. Any field NOT named in
 * `partial` is preserved from the existing record.
 *
 * Why this exists: `setSettings(...)` is full-replace, and several callers
 * (auth.ts persistLoginPassword, unlock.ts cacheUnlockBlob, and any future
 * settings-touching caller) historically hand-listed every field when
 * constructing the next Settings record. Every new field on the Settings
 * type meant editing all of those sites; missing one silently wipes that
 * field on the next call. The unlock.ts call site already wipes
 * loginPwdXor today — a latent bug pre-dating PHI work.
 *
 * Discipline replacement: this function is the single hand-list site for
 * Settings defaults. New optional fields added to Settings need exactly
 * one default added here. `merged: Settings` is type-asserted so a new
 * REQUIRED field without a default is a compile error, not a runtime miss.
 *
 * Atomicity: read-modify-write under no lock. Concurrent calls in the same
 * tab can race, but ward-helper is single-tab single-user; the existing
 * setSettings has the same property.
 */
export async function patchSettings(partial: Partial<Settings>): Promise<void> {
  const existing = await getSettings();
  const merged: Settings = {
    apiKeyXor: existing?.apiKeyXor ?? new Uint8Array(0),
    deviceSecret: existing?.deviceSecret ?? new Uint8Array(0),
    lastPassphraseAuthAt: existing?.lastPassphraseAuthAt ?? null,
    prefs: existing?.prefs ?? {},
    cachedUnlockBlob: existing?.cachedUnlockBlob ?? null,
    loginPwdXor: existing?.loginPwdXor ?? null,
    phiSalt: existing?.phiSalt ?? null,
    ...partial,
  };
  await setSettings(merged);
}

export interface DbStats {
  patients: number;
  notes: number;
  estimatedBytes: number;
  oldestNoteAt: number | null;
  newestNoteAt: number | null;
}

/**
 * Lightweight stats for the debug panel. No per-record decryption — bytes
 * are a rough estimate so the user can eyeball whether local storage is
 * bloating up.
 *
 * PR-B2.1: post-encryption (B2.2 world) notes are stored as SealedNoteRow
 * with `bodyHebrew` inside the encrypted envelope, NOT at row top-level.
 * Reading `n.bodyHebrew.length` on an encrypted row would yield `undefined`.
 * The "decrypt every note for a debug byte count" alternative is absurd
 * cost for a number whose docblock already says "rough" — so the byte
 * estimate switches to a ciphertext-length-derived figure on encrypted rows.
 *
 * AES-GCM overhead is deterministic per envelope: 12-byte IV (separate
 * field in Sealed) + 16-byte auth tag appended to the ciphertext. So
 * `ciphertext.length - 16` ≈ plaintext byte count. Multiply by ~1 (already
 * bytes, not chars) for the estimate. The existing per-note `+ 256` overhead
 * constant covers row scaffolding and is preserved.
 *
 * Encrypted rows also lose access to top-level `updatedAt` / `createdAt`,
 * so the oldest/newest timestamp computation is skipped on those rows.
 * Acceptable degradation — these are debug-panel hints, not clinical data.
 *
 * For temporal range queries on encrypted rows post-B2.2, callers should
 * materialize a decrypted list first (via listAllNotes) and compute then.
 */
export async function getDbStats(): Promise<DbStats> {
  const db = await getDb();
  const patients = await db.count('patients');
  const notes = (await db.getAll('notes')) as Array<Note | SealedNoteRow>;
  let estimatedBytes = patients * 256;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const n of notes) {
    if (isEncryptedRow(n)) {
      // Ciphertext-length-derived estimate. Auth tag is 16 bytes
      // appended to the GCM output; subtracting it approximates the
      // plaintext byte count. Comment retained so a future reader
      // doesn't "fix" this to call unsealRow.
      const ctLen = n.enc.ciphertext.byteLength;
      const plaintextBytesApprox = Math.max(0, ctLen - 16);
      estimatedBytes += plaintextBytesApprox + 256;
      // No createdAt/updatedAt at top level on encrypted rows — skip
      // this row's contribution to the temporal range. (Debug-panel
      // figure; clinically irrelevant.)
      continue;
    }
    estimatedBytes += (n.bodyHebrew?.length ?? 0) * 2 + 256;
    const t = n.updatedAt ?? n.createdAt ?? 0;
    if (t) {
      if (oldest === null || t < oldest) oldest = t;
      if (newest === null || t > newest) newest = t;
    }
  }
  return {
    patients,
    notes: notes.length,
    estimatedBytes,
    oldestNoteAt: oldest,
    newestNoteAt: newest,
  };
}

export async function listNotesByTeudatZehut(
  teudatZehut: string,
): Promise<{ patient: Patient | null; notes: Note[] }> {
  const tz = teudatZehut.trim();
  if (!tz) return { patient: null, notes: [] };
  // PR-B2.1: route through listPatients() + listNotes() so this site
  // crosses the encryption seam. Pre-B2.1 this function did
  // `db.getAll('patients')` + `db.getAllFromIndex('notes', 'by-patient',
  // p.id)` direct — the PR #166 review caught that the direct
  // getAll-patients bypassed listPatients, and the design pin
  // generalized to "every read site must cross the seam." Routing
  // through listPatients fixes the bypass; routing the per-match note
  // lookup through listNotes() fixes the same bypass on the by-patient
  // side. The by-patient index itself keeps working — patientId stays
  // plaintext top-level on encrypted rows (SealedNoteRow).
  //
  // v7+: by-tz index dropped (PR-B1); listPatients() returns a full
  // scan that we filter by teudatZehut in JS. ~30ms at ward scale.
  const allPatients = await listPatients();
  const matches = allPatients.filter((p) => p.teudatZehut === tz);
  if (matches.length === 0) return { patient: null, notes: [] };
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  const patient = matches[0]!;
  // Pull notes for ALL tz-matches (handles the duplicate-tz edge case
  // where two patient rows share a teudatZehut from a prior index-era
  // miss-split; combined notes are returned so continuity / banner show
  // the union).
  const notesByPatient = await Promise.all(matches.map((p) => listNotes(p.id)));
  const notes = notesByPatient.flat();
  return { patient, notes };
}
