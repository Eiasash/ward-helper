/**
 * Sequential batch SOAP runner — Phase E, v1.38.0.
 *
 * Drives N roster patients → N SOAPs in a single async loop:
 *   1. Skills loaded once for the whole batch (same content for every
 *      iteration — no point re-fetching).
 *   2. Per-iteration: check abort, extract from clinical images, merge
 *      roster identity, emit SOAP, save IDB+cloud, record completion.
 *   3. Per-iteration try/catch — a single failed patient does NOT abort
 *      the loop. Failure lands in `result.failed`, the loop continues.
 *   4. Abort flag checked at the top of each iteration AND between phase
 *      boundaries inside an iteration (extract → emit → save). Plus the
 *      AbortSignal threads down through runExtractTurn → generateNote →
 *      callAnthropic, so an in-flight fetch is canceled immediately, not
 *      after timeout.
 *
 * NOT parallel by design — Anthropic API rate limits, cost predictability,
 * and crash-recovery determinism all favor sequential. User-confirmed in
 * the original "Today's ward" thread.
 *
 * Identity-merge contract — load-bearing for Phase E UX:
 *   The doctor photographs CLINICAL CONTENT ONLY (vitals strip, problem
 *   list, labs) per patient. Identity comes from RosterPatient (already
 *   confirmed in the import modal preview). `mergeRosterIdentity` blends
 *   the two: roster wins on identity (name, tz, age, sex, room — these
 *   are high-confidence by the time the doctor commits the modal),
 *   extract wins on clinical (chief, pmh, meds, allergies, labs, vitals).
 *   This kills the "re-photograph patient card per batch iteration" UX
 *   collapse — for a 6-patient roster, that's 6 wasted photo steps the
 *   doctor doesn't have to take.
 */

import { runExtractTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { generateNote } from './orchestrate';
import { saveBoth } from './save';
import { recordError } from '@/agent/debugLog';
import type { CaptureBlock } from '@/camera/session';
import type { ParseFields } from '@/agent/tools';
import type { SoapMode } from './soapMode';
import type { RosterPatient } from '@/storage/roster';

export type BatchStatus =
  | 'pending'
  | 'extracting'
  | 'emitting'
  | 'saving'
  | 'done'
  | 'failed'
  | 'aborted';

export interface BatchProgressEvent {
  index: number;
  total: number;
  patient: RosterPatient;
  status: BatchStatus;
  /** Populated for status === 'failed' or 'aborted'. */
  error?: string;
}

export interface BatchOptions {
  /** One CaptureBlock array per patient; lengths must match patients[]. */
  images: ReadonlyArray<readonly CaptureBlock[]>;
  /** Fired before/after each phase boundary. UI subscribes to render progress. */
  onProgress: (event: BatchProgressEvent) => void;
  /** Required. UI binds a "בטל" button to controller.abort(). */
  abortSignal: AbortSignal;
  /** Optional global override applied to every SOAP in the batch. */
  soapMode?: SoapMode;
}

export interface BatchResult {
  /** Persisted notes — matches saveBoth's return shape per patient. */
  completed: Array<{ patientId: string; noteId: string }>;
  /** Patients whose iteration threw. RosterPatient.id used as the key (no `patientId` available since the patient row was never minted). */
  failed: Array<{ patientId: string; error: string }>;
  /** True iff opts.abortSignal fired at any point during the loop. */
  aborted: boolean;
}

/**
 * Merge RosterPatient identity into extract fields.
 *
 * Roster wins on identity fields (name, tz, age, sex, room) — these are
 * high-confidence because the doctor confirmed them in the import modal
 * preview before setRoster landed. Extract wins on clinical fields
 * (chief, pmh, meds, allergies, labs, vitals) — the model just read
 * them off the photographed clinical strip.
 *
 * Exposed for unit testing. `runBatchSoap` calls this internally between
 * extract and emit phases.
 */
export function mergeRosterIdentity(
  rp: RosterPatient,
  extract: ParseFields,
): ParseFields {
  return {
    // Identity — roster wins, extract is fallback for whatever roster lacks.
    name: rp.name || extract.name,
    teudatZehut: rp.tz ?? extract.teudatZehut,
    age: rp.age ?? extract.age,
    sex: rp.sex ?? extract.sex,
    room: rp.room ?? extract.room,
    // Clinical — only extract fills these. RosterPatient has no clinical
    // surface (intentional — roster is identity-only by design; the
    // dxShort field is for UI display, not for model emit input).
    chiefComplaint: extract.chiefComplaint,
    pmh: extract.pmh,
    meds: extract.meds,
    allergies: extract.allergies,
    labs: extract.labs,
    vitals: extract.vitals,
  };
}

/**
 * Run a batch of SOAP notes — N patients → N notes, sequential. Returns
 * a structured result rather than throwing on per-patient failure; the
 * UI uses this to render a per-row outcome badge after the loop finishes.
 */
export async function runBatchSoap(
  patients: ReadonlyArray<RosterPatient>,
  opts: BatchOptions,
): Promise<BatchResult> {
  if (patients.length !== opts.images.length) {
    throw new Error(
      `runBatchSoap: patients (${patients.length}) and images (${opts.images.length}) array lengths must match`,
    );
  }

  const result: BatchResult = {
    completed: [],
    failed: [],
    aborted: false,
  };

  // Skills loaded once. The same SOAP system prompt content drives every
  // iteration; re-loading per iteration would just thrash the cache.
  const skillContent = await loadSkills(['azma-ui', 'hebrew-medical-glossary']);
  const soapMode = opts.soapMode ?? 'general';

  for (let i = 0; i < patients.length; i++) {
    // Top-of-iteration abort check. Without this, a "בטל" tap right after
    // patient i-1 finishes would still run i unnecessarily.
    if (opts.abortSignal.aborted) {
      result.aborted = true;
      break;
    }

    const patient = patients[i]!;
    const images = opts.images[i]!;

    opts.onProgress({ index: i, total: patients.length, patient, status: 'extracting' });

    try {
      // Phase 1: extract from clinical photos. abortSignal threads through
      // callAnthropic so an in-flight fetch is canceled immediately on
      // controller.abort() — not after the 45s timeout fires.
      const extract = await runExtractTurn(images, skillContent, opts.abortSignal);
      if (opts.abortSignal.aborted) {
        result.aborted = true;
        opts.onProgress({
          index: i,
          total: patients.length,
          patient,
          status: 'aborted',
        });
        break;
      }

      // Phase 2: emit SOAP. mergeRosterIdentity bridges between sparse
      // extract output (clinical only — no patient card photo means no
      // identity from the model) and the high-confidence identity the
      // doctor already confirmed in the modal.
      opts.onProgress({ index: i, total: patients.length, patient, status: 'emitting' });
      const fields = mergeRosterIdentity(patient, extract.fields);
      const noteBody = await generateNote(
        'soap',
        { fields, confidence: {} },
        null, // batch: no continuity per brief — isolated per patient
        soapMode,
        opts.abortSignal,
      );
      if (opts.abortSignal.aborted) {
        result.aborted = true;
        opts.onProgress({
          index: i,
          total: patients.length,
          patient,
          status: 'aborted',
        });
        break;
      }

      // Phase 3: save. Local IDB write is unsabortable (essentially
      // synchronous); cloud push is best-effort and won't bail on abort.
      // Saving immediately means a crash mid-batch still leaves the
      // already-completed notes intact.
      opts.onProgress({ index: i, total: patients.length, patient, status: 'saving' });
      const saved = await saveBoth(fields, 'soap', noteBody);
      result.completed.push({ patientId: saved.patientId, noteId: saved.noteId });
      opts.onProgress({ index: i, total: patients.length, patient, status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // AbortError surfacing during a phase = whole-batch cancel. Mark
      // this patient as aborted (not failed) and exit the loop — failed
      // is reserved for genuine per-patient errors that should not
      // suppress the rest of the batch.
      if (opts.abortSignal.aborted) {
        result.aborted = true;
        opts.onProgress({
          index: i,
          total: patients.length,
          patient,
          status: 'aborted',
          error: msg,
        });
        break;
      }
      result.failed.push({ patientId: patient.id, error: msg });
      recordError(err, {
        phase: 'batch',
        context: `patient ${i + 1}/${patients.length}`,
      });
      opts.onProgress({
        index: i,
        total: patients.length,
        patient,
        status: 'failed',
        error: msg,
      });
      // Continue — do NOT throw out of the loop. Brief invariant.
    }
  }

  return result;
}
