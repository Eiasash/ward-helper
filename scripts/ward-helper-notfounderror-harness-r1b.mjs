#!/usr/bin/env node
/**
 * ward-helper-notfounderror-harness-r1b — R1 variant (b): the H2 racy
 * interleave probe (chaos fired WHILE an in-flight scan transaction is
 * open). Sibling of ward-helper-notfounderror-harness.mjs (R1 variant a,
 * the merged + calibrated H1 regression probe — deliberately NOT modified
 * here: CLAUDE.md rule 3, #184's calibration is load-bearing).
 *
 * Authority: docs/audit/2026-05-17-notfounderror-repro-spec.md (AMENDED)
 * + the LOCKED gate sections of
 * docs/audit/2026-05-17-notfounderror-harness-run.md. THIS IS v2.
 *
 * v1 REJECTED as harness self-contamination (between-iteration
 * safeNavigate+seedMany raced the v0->v7 upgrade against the prior
 * iteration's deleteDatabase — verbatim signature of the documented
 * R1(a) bug #2). v2 fix (LOCKED gate, committed before this rebuild):
 *   - Navigate the app ONCE (no per-iteration reload).
 *   - Each iteration, inside one awaited page.evaluate:
 *       awaitSchemaReady() opens ward-helper at EXPLICIT version 7 with
 *       guarded createObjectStore for the exact v7 schema, fully awaited
 *       (success + close). No concurrent open queues behind a blocked
 *       delete -> the rebuild race that contaminated v1 is gone.
 *   - Per-iteration capture-buffer isolation (snapshot length BEFORE,
 *     read only entries past it — NOT slice(-N) trailing window).
 *   - Contamination re-check is the FIRST verdict gate; if it trips,
 *     B2 ships and the investigation stops (one rebuild attempt, max).
 *
 * UNCALIBRATABLE BY DESIGN (reverting #182 -> H1 deadlock, not H2). The
 * rule-6 realization is R2-trace fault-ASSIGNMENT; a uniform-no-fire is
 * honest absence-evidence, never "H2 excluded".
 *
 * Run:
 *   HARNESS_ITERS=30 EXPECT_WARD_VERSION=ward-v1.46.3 \
 *     node scripts/ward-helper-notfounderror-harness-r1b.mjs
 *
 * No auth, no API key, no Anthropic / proxy traffic.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

import { safeNavigate } from './lib/harnessNav.mjs';
import { TRACE_SHIM_SRC, drainTrace, snapshotIdb } from './lib/idbTraceShim.mjs';

const ITERATIONS = Number(process.env.HARNESS_ITERS ?? 10);
const BASE_URL = process.env.HARNESS_BASE_URL ?? 'https://eiasash.github.io/ward-helper/';
const EXPECT_WARD_VERSION = process.env.EXPECT_WARD_VERSION ?? '';
const READY_SEL = 'nav[aria-label="ניווט ראשי"]';
const SEED_ROWS = Number(process.env.HARNESS_SEED_ROWS ?? 2000);
const RACE_WINDOW_MS = 220;
const REPORT_DIR = 'chaos-reports';
const FAULT_NAMES = new Set(['NotFoundError', 'AbortError', 'InvalidStateError']);
// Contamination fingerprints (LOCKED v2 gate, hard re-check FIRST).
const CONTAM_RE = /aborted in upgradeneeded|One of the specified object stores was not found/i;

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function ruleFourSelfTest() {
  const src = await fs.readFile(new URL(import.meta.url), 'utf8');
  const offenders = src
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\bpage\.(goto|reload)\s*\(/.test(l) && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  if (offenders.length) {
    throw new Error(`rule-4 self-test FAILED: bare page.goto/page.reload lines ${offenders.map(([n]) => n).join(', ')}`);
  }
}

async function r0Gate() {
  if (!EXPECT_WARD_VERSION) {
    throw new Error('R0: EXPECT_WARD_VERSION not set. Refusing — the version gate is non-negotiable.');
  }
  const swUrl = new URL('sw.js', BASE_URL).href;
  const res = await fetch(swUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`R0: GET ${swUrl} -> HTTP ${res.status}.`);
  const firstLine = (await res.text()).split('\n')[0];
  const m = firstLine.match(/ward-v[\w.\-]+/);
  const live = m ? m[0] : `(unparseable: ${firstLine.slice(0, 80)})`;
  if (live !== EXPECT_WARD_VERSION) {
    throw new Error(`R0 HARD GATE FAILED: live = "${live}", expected "${EXPECT_WARD_VERSION}". STOP.`);
  }
  return { swUrl, live };
}

/**
 * One R1(b) v2 iteration — entirely inside one awaited page.evaluate.
 * faithful=true mirrors v1.46.3's connection lifecycle EXACTLY
 * (src/storage/indexed.ts:269-284). faithful=false = internal POSITIVE
 * CONTROL (pre-fix model, no lifecycle listeners) on the SAME
 * awaited-rebuild path so its fire (if any) is a clean mechanism.
 */
async function probeOnceB2(page, iter, faithful, rec) {
  const beforeRej = rec ? rec.rejections.length : 0;
  const beforePE = rec ? rec.pageerrors.length : 0;
  let pe;
  try {
    pe = await page.evaluate(async ({ faithful, seedRows, windowMs }) => {
      const NAME = 'ward-helper';
      const out = { phase: [], events: [], scan: null, postChaosTx: null, deleteOutcome: null, errs: [] };

      // --- 1. awaitSchemaReady: EXPLICIT v7, guarded createObjectStore,
      // fully awaited. No concurrent open => no upgrade-race (the v1
      // contamination source). Mirrors the final v7 schema exactly.
      await new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, 7);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('patients')) db.createObjectStore('patients', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('notes')) {
            const n = db.createObjectStore('notes', { keyPath: 'id' });
            n.createIndex('by-patient', 'patientId');
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
          if (!db.objectStoreNames.contains('roster')) db.createObjectStore('roster', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('daySnapshots')) db.createObjectStore('daySnapshots', { keyPath: 'id' });
        };
        r.onsuccess = () => { try { r.result.close(); } catch (_) {} resolve(); };
        r.onerror = () => reject(r.error || new Error('schemaReady-error'));
        r.onblocked = () => reject(new Error('schemaReady-blocked'));
        setTimeout(() => reject(new Error('schemaReady-timeout-8s')), 8000);
      }).catch((e) => { out.phase.push('schemaReady-FAIL:' + String(e && (e.message || e))); });
      if (out.phase.some((p) => p.startsWith('schemaReady-FAIL'))) return out;
      out.phase.push('schemaReady-ok');

      // --- 2. seed on the clean v7 schema (explicit v7 open, awaited).
      await new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, 7);
        r.onsuccess = () => {
          const db = r.result;
          let tx;
          try { tx = db.transaction(['patients'], 'readwrite'); }
          catch (e) { db.close(); return reject(e); }
          const os = tx.objectStore('patients');
          const pad = 'x'.repeat(400);
          for (let i = 0; i < seedRows; i += 1) {
            os.put({
              id: `nf-b-${i}`, name: `בדיקה ${i}`, teudatZehut: String(100000000 + i),
              dob: '01/01/1950', room: String(i % 40), tags: [], note: pad,
              createdAt: Date.now(), updatedAt: Date.now() + i,
            });
          }
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error || new Error('seed-tx-error')); };
          tx.onabort = () => { db.close(); reject(tx.error || new Error('seed-abort')); };
        };
        r.onerror = () => reject(r.error || new Error('seed-open-error'));
        setTimeout(() => reject(new Error('seed-open-timeout-8s')), 8000);
      }).catch((e) => { out.phase.push('seed-FAIL:' + String(e && (e.message || e))); });
      if (out.phase.some((p) => p.startsWith('seed-FAIL'))) return out;
      out.phase.push('seed-ok');

      // --- 3. open the probe connection P (explicit v7).
      const P = await new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, 7);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('P-open-error'));
        r.onblocked = () => reject(new Error('P-open-blocked'));
        setTimeout(() => reject(new Error('P-open-timeout-5s')), 5000);
      }).catch((e) => ({ pOpenError: String(e && (e.message || e)) }));
      if (P && P.pOpenError) { out.phase.push('P-open-FAIL:' + P.pOpenError); return out; }
      out.phase.push('P-open-ok');

      let closed = false;
      if (faithful) {
        // EXACT mirror of indexed.ts:279-284.
        P.addEventListener('versionchange', () => {
          try { P.close(); } catch (_) {}
          closed = true;
          out.events.push('versionchange->close()+invalidate');
        });
        P.addEventListener('close', () => { closed = true; out.events.push('close->invalidate'); });
      } else {
        out.events.push('POSITIVE-CONTROL: no lifecycle listeners (pre-fix model)');
      }

      // --- 4. in-flight scan on P (the op the 4 PR-B1 primitives reduce to).
      let scanResolve;
      const scanP = new Promise((r) => { scanResolve = r; });
      try {
        const tx = P.transaction(['patients'], 'readonly');
        const req = tx.objectStore('patients').getAll();
        req.onsuccess = () => scanResolve({ ok: true, n: Array.isArray(req.result) ? req.result.length : -1 });
        req.onerror = () => scanResolve({ ok: false, name: req.error && req.error.name, message: req.error && req.error.message });
        tx.onabort = () => scanResolve({ ok: false, aborted: true, name: tx.error && tx.error.name, message: tx.error && tx.error.message });
      } catch (e) {
        scanResolve({ ok: false, threw: true, name: e && e.name, message: e && e.message });
      }

      // --- 5. fire chaos (deleteDatabase = the faithful versionchange
      // trigger) at a randomized mid-scan offset.
      await new Promise((r) => setTimeout(r, Math.random() * windowMs));
      out.deleteOutcome = await new Promise((resolve) => {
        let settled = false;
        const done = (o) => { if (!settled) { settled = true; resolve(o); } };
        let dr;
        try { dr = indexedDB.deleteDatabase(NAME); }
        catch (e) { return done({ outcome: 'errored', name: e && e.name, message: e && e.message }); }
        dr.onsuccess = () => done({ outcome: 'completed' });
        dr.onblocked = () => done({ outcome: 'blocked' });
        dr.onerror = () => done({ outcome: 'errored', name: dr.error && dr.error.name, message: dr.error && dr.error.message });
        setTimeout(() => done({ outcome: 'timeout' }), 6000);
      });

      out.scan = await Promise.race([
        scanP, new Promise((r) => setTimeout(() => r({ ok: false, scanTimeout: true }), 6000)),
      ]);

      // --- 6. LITERAL H2 trigger: reach transaction()/objectStore() on a
      // possibly-closed/schema-less P after the chaos.
      try {
        const tx2 = P.transaction(['patients'], 'readonly');
        tx2.objectStore('patients');
        out.postChaosTx = { ok: true };
      } catch (e) {
        out.postChaosTx = { ok: false, name: e && e.name, message: (e && (e.message || '') || '').slice(0, 220) };
      }
      out.closed = closed;
      try { P.close(); } catch (_) {}
      return out;
    }, { faithful, seedRows: faithful ? SEED_ROWS : Math.min(SEED_ROWS, 1200), windowMs: RACE_WINDOW_MS });
  } catch (e) {
    pe = { evalError: String(e && (e.message || e)).slice(0, 400) };
  }

  await page.waitForTimeout(700);
  const trace = await drainTrace(page, 30);
  const idb = await snapshotIdb(page);

  // Per-iteration buffer isolation: only entries that arrived during THIS
  // iteration (no slice(-N) trailing window — that was the v1 bleed bug).
  const newRej = rec ? rec.rejections.slice(beforeRej) : [];
  const newPE = rec ? rec.pageerrors.slice(beforePE) : [];
  const windowErrs = [...newRej, ...newPE];

  // Candidate fault names: probe's own observed scan / postChaosTx +
  // this-iteration window capture.
  const probeNamed = [];
  if (pe && pe.scan && pe.scan.name) probeNamed.push({ name: pe.scan.name, where: 'in-flight-getAll', message: pe.scan.message });
  if (pe && pe.postChaosTx && pe.postChaosTx.ok === false && pe.postChaosTx.name) {
    probeNamed.push({ name: pe.postChaosTx.name, where: 'post-chaos-tx', message: pe.postChaosTx.message });
  }
  const named = [
    ...windowErrs.map((e) => ({ name: e.name, where: 'window', message: e.message, stack: e.stack })),
    ...probeNamed,
  ].filter((e) => e.name);

  // ---- v2 LOCKED gate: CONTAMINATION RE-CHECK FIRST ----
  const idbEmpty = !!(idb && idb.wardHelper && idb.wardHelper.version === 1 &&
                      Array.isArray(idb.wardHelper.stores) && idb.wardHelper.stores.length === 0);
  const contamHit =
    named.some((e) => CONTAM_RE.test(String(e.message || ''))) ||
    (pe && pe.scan && CONTAM_RE.test(String(pe.scan.message || ''))) ||
    (pe && pe.postChaosTx && CONTAM_RE.test(String(pe.postChaosTx.message || ''))) ||
    trace.slice(-10).some((t) => /open/.test(String(t.op || '')) && false) || // (open ops alone are fine in v2)
    false;
  // The decisive contamination signature: a NotFounded "object stores not
  // found" co-occurring with a version:1 empty snapshot, OR any
  // "aborted in upgradeneeded".
  const contaminated =
    named.some((e) => /aborted in upgradeneeded/i.test(String(e.message || ''))) ||
    (CONTAM_RE.test(String((pe && pe.scan && pe.scan.message) || '')) && idbEmpty) ||
    (CONTAM_RE.test(String((pe && pe.postChaosTx && pe.postChaosTx.message) || '')) && idbEmpty) ||
    contamHit;

  const traceTail = trace.slice(-8);
  const tailNamesScanOp = traceTail.some(
    (t) => /patients|notes/.test(String(t.store || '')) &&
           /transaction|getAll|get|openCursor|index\./.test(String(t.op || '')),
  );
  const schemaIntact = !!(idb && idb.wardHelper && Array.isArray(idb.wardHelper.stores) &&
                          idb.wardHelper.stores.includes('patients'));
  const faultHit = named.find((e) => FAULT_NAMES.has(e.name));

  let assignment = null;
  let fired = false;
  if (contaminated) {
    assignment = 'CONTAMINATION re-check TRIPPED (upgrade-race / object-store-not-found + empty snapshot) — NOT a finding';
  } else if (faultHit && tailNamesScanOp && schemaIntact) {
    const stackCacheBlob = windowErrs.some((e) => /caches|CacheStorage|Blob|OPFS|FileSystem|revokeObjectURL/i.test(String(e.stack || '')));
    if (faultHit.name === 'NotFoundError' && stackCacheBlob) assignment = 'H3 (NotFoundError + Cache/Blob/OPFS stack on intact schema)';
    else if (faultHit.name === 'NotFoundError') assignment = 'H2 (NotFoundError + in-flight IDB scan tail, schema intact)';
    else if (faultHit.name === 'AbortError') assignment = 'AbortError — in-flight tx force-closed on intact schema (H2-adjacent, genuine)';
    else if (faultHit.name === 'InvalidStateError') assignment = 'InvalidStateError on closed handle (H1 residue, genuine)';
    fired = true;
  } else if (faultHit) {
    assignment = `fault ${faultHit.name} but no clean trace assignment (tailScan=${tailNamesScanOp} schemaIntact=${schemaIntact}) — per gate NOT a finding`;
  }

  return {
    iter, faithful,
    fired, contaminated,
    faultName: faultHit ? faultHit.name : null,
    assignment,
    deleteOutcome: pe && pe.deleteOutcome,
    probe: pe,
    newRej: newRej.map((e) => ({ n: e.name, m: (e.message || '').slice(0, 90) })),
    newPE: newPE.map((e) => ({ n: e.name, m: (e.message || '').slice(0, 90) })),
    traceTail,
    idbSnapshot: idb,
  };
}

async function main() {
  const startedAt = Date.now();
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const report = {
    spec: 'repro-spec (AMENDED) + run-doc R1(b) v2 LOCKED gate',
    variant: 'R1(b) v2 — chaos interleaved with in-flight getAll (H2 racy), contamination-hardened',
    baseUrl: BASE_URL, expectVersion: EXPECT_WARD_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    uncalibratable: true, seedRows: SEED_ROWS, iterations: ITERATIONS,
    r0: null, positiveControl: [], realRuns: [],
    firedCount: 0, controlFiredCount: 0, contaminatedCount: 0, controlContaminatedCount: 0,
    verdict: null, durationMs: 0,
  };

  await ruleFourSelfTest();
  report.r0 = await r0Gate();
  console.log(`R0 OK — ${report.r0.swUrl} = ${report.r0.live} == EXPECT`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(TRACE_SHIM_SRC);
  await context.addInitScript(`
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      try {
        console.error('[HARNESS_REJECTION] ' + JSON.stringify({
          name: r && r.name || null,
          message: (r && r.message || String(r)).slice(0, 400),
          stack: (r && r.stack || '').slice(0, 1200)
        }));
      } catch (_) { console.error('[HARNESS_REJECTION] {"name":"(unserializable)"}'); }
    });
  `);

  const page = await context.newPage();
  try {
    // Navigate ONCE. No per-iteration reload (that was the v1 contam source).
    const rec = await safeNavigate(page, BASE_URL, { readySel: READY_SEL });

    // Positive control FIRST (detector-liveness proof on the SAME awaited
    // path; not a determinism sweep). Pre-fix model => expect either a
    // clean H2-ish fault OR the H1 blocked-delete (also a valid "the
    // detector + chaos plumbing work" signal).
    const CONTROL_ITERS = Math.min(3, ITERATIONS);
    for (let i = 1; i <= CONTROL_ITERS; i += 1) {
      const r = await probeOnceB2(page, i, /* faithful */ false, rec);
      report.positiveControl.push(r);
      if (r.fired) report.controlFiredCount += 1;
      if (r.contaminated) report.controlContaminatedCount += 1;
      console.log(`  control ${i}/${CONTROL_ITERS}: fired=${r.fired} contam=${r.contaminated} ` +
        `del=${r.deleteOutcome && r.deleteOutcome.outcome} fault=${r.faultName} :: ${r.assignment || '-'}`);
    }

    for (let i = 1; i <= ITERATIONS; i += 1) {
      const r = await probeOnceB2(page, i, /* faithful */ true, rec);
      report.realRuns.push(r);
      if (r.fired) report.firedCount += 1;
      if (r.contaminated) report.contaminatedCount += 1;
      console.log(`  real ${i}/${ITERATIONS}: fired=${r.fired} contam=${r.contaminated} ` +
        `del=${r.deleteOutcome && r.deleteOutcome.outcome} ` +
        `scan=${r.probe && r.probe.scan ? JSON.stringify(r.probe.scan).slice(0, 60) : '-'} ` +
        `postTx=${r.probe && r.probe.postChaosTx ? JSON.stringify(r.probe.postChaosTx).slice(0, 60) : '-'}`);
    }

    // ---- v2 LOCKED verdict ----
    const anyContam = report.contaminatedCount > 0 || report.controlContaminatedCount > 0;
    const controlProvenLive = report.controlFiredCount > 0 ||
      report.positiveControl.some((r) => r.deleteOutcome && (r.deleteOutcome.outcome === 'blocked' || r.deleteOutcome.outcome === 'timeout'));
    if (anyContam) {
      report.verdict = {
        path: 'B2',
        statement:
          `v2 STILL self-contaminates (contam real=${report.contaminatedCount}/${ITERATIONS}, ` +
          `control=${report.controlContaminatedCount}/${report.positiveControl.length}). ` +
          `Per the LOCKED v2 gate: ONE rebuild attempt max — ship B2, STOP. R1(b) is ` +
          `uncalibratable and its best-case value (weak absence-evidence) is already ` +
          `supplied by R1(a)'s deadlock calibration. Do NOT rebuild a third time.`,
      };
    } else if (report.firedCount >= 1) {
      report.verdict = {
        path: 'A',
        statement:
          `R1(b) v2 FIRED ${report.firedCount}/${ITERATIONS} on ${EXPECT_WARD_VERSION}, ` +
          `contamination-clean, trace-assignable. PATH A — genuine finding. Root-cause ` +
          `fix is OUT OF SCOPE (scope-stop): report + park, do not branch.`,
      };
    } else if (!controlProvenLive) {
      report.verdict = {
        path: 'B2',
        statement:
          `R1(b) v2 real 0/${ITERATIONS} but the positive control never fired AND never ` +
          `produced a blocked/timeout chaos signal — detector liveness NOT proven. ` +
          `Untrustworthy clean -> B2.`,
      };
    } else {
      report.verdict = {
        path: 'B (absence-evidence)',
        statement:
          `R1(b) v2 real ${report.firedCount}/${ITERATIONS} on ${EXPECT_WARD_VERSION}, ` +
          `contamination-clean; positive control proved the chaos+detector plumbing live ` +
          `(fired or blocked/timeout on the pre-fix model). Honest ABSENCE-EVIDENCE: the ` +
          `H2 IDB-scan-vs-close path is NOT driveable to a literal NotFoundError on the ` +
          `post-fix build via this harness. Explicitly NOT "H2/H3/H4 excluded by proof" ` +
          `(uncalibratable). 0/${ITERATIONS} on R0-gated ${EXPECT_WARD_VERSION} also ` +
          `satisfies R4 (post-fix regression gate incl. the overlap path).`,
      };
    }
  } catch (e) {
    report.fatalError = String(e?.stack ?? e).slice(0, 1500);
    report.verdict = { path: 'ERROR', statement: report.fatalError };
  } finally {
    await context.close();
    await browser.close();
  }

  report.durationMs = Date.now() - startedAt;
  const outPath = path.join(REPORT_DIR, `notfounderror-r1b-v2-${ts()}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== NotFoundError harness — R1(b) v2 (contamination-hardened) ===');
  console.log(`Base:     ${BASE_URL}`);
  console.log(`Version:  ${EXPECT_WARD_VERSION} (R0 ${report.r0 ? 'PASS' : 'FAIL'})`);
  console.log(`Seed:     ${SEED_ROWS} | iters: ${ITERATIONS}`);
  console.log(`Control:  fired ${report.controlFiredCount}/${report.positiveControl.length} contam ${report.controlContaminatedCount}`);
  console.log(`Real:     fired ${report.firedCount}/${ITERATIONS} contam ${report.contaminatedCount}`);
  console.log(`Verdict:  ${report.verdict?.path}`);
  console.log(report.verdict?.statement ?? '');
  console.log(`Report:   ${outPath}`);

  if (report.verdict?.path === 'ERROR') process.exit(2);
  if (report.verdict?.path === 'B2') process.exit(2);
  process.exit(report.firedCount >= 1 ? 1 : 0);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
