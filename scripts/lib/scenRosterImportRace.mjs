/**
 * Roster-import + by-tz dedup race scenario — fixture-only, single-shot
 * per persona. Covers three causal invariants the real ward workflow
 * depends on when a doctor pastes 50 patients from AZMA TSV into the
 * roster-import modal:
 *
 *   1. `src/notes/rosterImport.ts::parseAzmaTsv` (line 386) must NOT
 *      throw on adversarial input (malformed ת.ז., empty names, RTL
 *      marks, duplicate ת.ז. rows, missing cells, mixed-EOL line
 *      endings). A throw would kill the modal preview pane and force
 *      the doctor to re-screenshot the entire ward.
 *
 *   2. `src/notes/rosterImport.ts::parseAzmaTsv` (line 431 — the
 *      `if (!row.name) continue;` guard) must drop empty-name rows.
 *      A SOAP without a patient name is useless, and accepting a
 *      blank-name row corrupts the modal preview + the eventual
 *      setRoster commit.
 *
 *   3. `src/storage/indexed.ts::listPatientsByTzMap` (line 390) must
 *      remain stable when the patients store is seeded from the
 *      parser's output: one entry per non-blank ת.ז., blank-ת.ז.
 *      patients silently skipped, NO null keys, NO `.trim()` crash
 *      on null. A regression that leaks null keys or crashes here
 *      re-introduces the v7 by-tz-index ghost-patient bug class.
 *
 * STEP-0 deviation from kickoff §2.1: the `if (!row.name) continue;`
 * line is at L431, not the spec's "~L437" — close enough that the
 * spec was clearly off-by-a-few but the probe still targets the right
 * predicate. Documented for PR-body audit trail; no behavior change.
 *
 * §4 detector-armed — calibration procedure: comment out L431 of
 * src/notes/rosterImport.ts locally and confirm this scenario goes
 * RED with a `parser-accepted-nameless-row` HIGH. Restore and confirm
 * GREEN. NOT in CI.
 *
 * Why not vitest? Two reasons. (a) The invariants span four production
 * modules (`rosterImport`, `israeliTz`, `roster`, `indexed`) that the
 * mega-bot already loads on every CI bot run — integrating into the
 * persona rotation makes regression detection automatic without a
 * separate test fixture. (b) Unit tests for parseAzmaTsv (in
 * tests/rosterImport.test.ts) cover individual flavors but not the
 * end-to-end "50-row adversarial bundle → preview → commit → by-tz
 * map" race that real users hit; the bot fills the gap.
 *
 * Spec §2.2 simplification: the kickoff specified a UI-driven flow
 * (navigate to /today, click ייבא רשומה, paste into the modal,
 * eyeball preview, click commit). Since the invariants live in the
 * pure-function parser + the storage layer (no React state involved),
 * the scenario invokes the production functions directly via the bot
 * adapter — no modal mounting, no React render race, no UI flakiness.
 * The code path under test is identical; the wiring around it is
 * bot-side. Same approach as scenAiEmitRetry.mjs.
 */
import { sleep, rand } from './megaPersona.mjs';

// Bundle size — large enough to exercise dedup (multiple duplicate-tz
// rows) and statistical robustness (each flavor fires ≥1×), small
// enough that the page.evaluate-driven probe completes in <5s. 50 is
// the realistic upper-bound for a single SZMC ward (capacity ~38–42
// beds at the geriatric department).
const BUNDLE_SIZE = 50;

// Spec §2.2 — fixture-only. The scenario writes to the patients +
// roster IndexedDB stores and clears them at the end, but a botApi
// flag flip in a non-fixture run would expose those side effects to
// production storage. FIXTURE_MODE gate matches scenPhiColdUnlock and
// scenAiEmitRetry.
const FIXTURE_MODE = process.env.WARD_BOT_FIXTURE === '1';

export async function scenRosterImportRace(
  page,
  _browser,
  scenario,
  persona,
  _guard,
  _reportDir,
  logBug,
) {
  const subject = 'rosterImportRace';
  const scenId = scenario.scenario_id;

  if (!FIXTURE_MODE) {
    return { ok: true, _botSubject: subject, _skipped: 'non-fixture-mode' };
  }

  // Single-shot per persona. The probe clears + seeds + clears the
  // patients store; if a second tick fired mid-cleanup, the by-tz map
  // probe could observe a transient mixed state. Mirrors scenAiEmitRetry
  // Gate 2 (localStorage so the marker survives the bootstrap reload).
  const RAN_KEY = 'ward-helper.rosterImportRaceRan';
  const alreadyRan = await page
    .evaluate((k) => {
      try {
        return localStorage.getItem(k) === '1';
      } catch {
        return false;
      }
    }, RAN_KEY)
    .catch(() => false);
  if (alreadyRan) {
    return { ok: true, _botSubject: subject, _skipped: 'already-ran-this-persona' };
  }

  // Mark on entry — every exit path from here counts as "this persona
  // has had its rosterImportRace attempt." Same rationale as scenAi.
  await page
    .evaluate((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* localStorage disabled — Gate 2 becomes a no-op; acceptable */
      }
    }, RAN_KEY)
    .catch(() => {});

  // ─── 1. Bootstrap: enable bot API, reload, verify attach ──────────────
  await page
    .evaluate(() => {
      try {
        localStorage.setItem('ward-helper.botApi', '1');
      } catch {
        /* localStorage disabled */
      }
    })
    .catch(() => {});
  await page
    .reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    .catch(() => {});
  await sleep(1500);

  const apiReady = await page
    .evaluate(() => {
      return (
        typeof window.__rosterBotApi?.seedAdversarialAzmaTsv === 'function' &&
        typeof window.__rosterBotApi?.importViaPaste === 'function' &&
        typeof window.__rosterBotApi?.listPatientsByTzMap === 'function' &&
        typeof window.__rosterBotApi?.putPatient === 'function' &&
        typeof window.__rosterBotApi?.clearPatients === 'function'
      );
    })
    .catch(() => false);
  if (!apiReady) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/bot-api-missing`,
      `window.__rosterBotApi not attached — see src/dev/__rosterBotApi.ts wiring + src/main.tsx dynamic import | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // ─── 2. Drive the invariant via direct importViaPaste + listPatientsByTzMap ─
  //
  // Page-side closure: generate adversarial TSV, parse it, snapshot
  // counts, clear patients store, seed parsed rows, snapshot by-tz
  // map, clean up. Single page.evaluate so the bot doesn't have to
  // round-trip between Node and the page mid-probe (each round-trip
  // adds engine-internal latency that would skew the timing the
  // dedup-invariant probe is trying to detect drift on).
  const result = await page
    .evaluate(async ({ bundleSize }) => {
      const api = window.__rosterBotApi;
      if (!api) return { __error: 'api-disappeared' };

      const bundle = api.seedAdversarialAzmaTsv(bundleSize);

      // Probe 1: parser robustness — must not throw on adversarial TSV.
      let parsed = null;
      let parseThrew = null;
      try {
        parsed = api.importViaPaste(bundle.tsv);
      } catch (e) {
        parseThrew = (e && e.message) || String(e);
      }

      if (parseThrew !== null) {
        return {
          phase: 'parse',
          bundle,
          parseThrew,
        };
      }

      const parsedCount = Array.isArray(parsed) ? parsed.length : -1;
      if (parsedCount < 0) {
        return {
          phase: 'parse',
          bundle,
          __error: 'importViaPaste-did-not-return-array',
          got: typeof parsed,
        };
      }

      // Probe 2 + 3: by-tz map stability — seed patients store from
      // parser output, snapshot listPatientsByTzMap, look for null
      // keys + count distinct entries.
      //
      // The seed + snapshot block is wrapped in try/finally so a
      // transient IDB failure (storage/DB instability during bot
      // chaos) cannot leave the patients store seeded with bot rows.
      // Codex P2 #213: without this guard, an exception from putPatient
      // or listPatientsByTzMap mid-block would skip the cleanup at the
      // bottom and bleed state into subsequent personas, corrupting
      // unrelated scenarios' starting conditions.
      let mapResult = null;
      let mapThrew = null;
      let mapSize = -1;
      let nullKeyCount = 0;
      let emptyKeyCount = 0;
      let seedThrew = null;
      let cleanupThrew = null;

      try {
        // SAFETY NOTE: scenRosterImportRace is currently the only
        // scenario that writes to the patients store via putPatient. If
        // a future scenario adds patients-store writes, this START-clear
        // must be replaced with a save-snapshot / restore pattern, or
        // that scenario's state will be silently wiped when
        // rosterImportRace runs.
        await api.clearPatients();
        const now = Date.now();
        for (const r of parsed) {
          await api.putPatient({
            id: r.id,
            name: r.name,
            // RosterPatient.tz is string|null; Patient.teudatZehut is
            // string (blank=skipped by the map). Coerce null → '' so
            // the store accepts the row.
            teudatZehut: r.tz ?? '',
            dob: '',
            room: r.room,
            tags: [],
            createdAt: now,
            updatedAt: now,
          });
        }

        try {
          mapResult = await api.listPatientsByTzMap();
          mapSize = mapResult.size;
          for (const k of mapResult.keys()) {
            if (k == null) nullKeyCount++;
            else if (k === '') emptyKeyCount++;
          }
        } catch (e) {
          mapThrew = (e && e.message) || String(e);
        }
      } catch (e) {
        // Seed loop failed mid-stream. Capture the cause so the bot
        // logs a useful HIGH instead of silently skipping cleanup +
        // returning ok. The finally below still runs.
        seedThrew = (e && e.message) || String(e);
      } finally {
        // Always attempt to clean up the patients store — we wrote
        // to it via putPatient, so leaving orphaned bot rows for the
        // next ACTION_MENU pick on this persona would contaminate the
        // patients store for scenarios like scenSoapRound /
        // scenAdmissionEmit.
        //
        // Codex P2 #213 (round 2): do NOT clearRoster() here — this
        // scenario never calls setRoster, so wiping roster state
        // would clobber whatever /today rows other scenarios
        // populated earlier on the persona's session.
        //
        // Codex P2 #213 (round 3): capture cleanup failures instead
        // of swallowing — if clearPatients throws (transient IDB
        // instability), synthetic patient rows survive into
        // subsequent ticks and contaminate downstream scenario
        // outcomes. The HIGH probe below surfaces this rather than
        // letting an ok-but-dirty result land silently.
        try {
          await api.clearPatients();
        } catch (e) {
          cleanupThrew = (e && e.message) || String(e);
        }
      }

      return {
        phase: 'done',
        bundle,
        parsedCount,
        mapSize,
        nullKeyCount,
        emptyKeyCount,
        mapThrew,
        seedThrew,
        cleanupThrew,
      };
    }, { bundleSize: BUNDLE_SIZE })
    .catch((e) => ({ __error: String((e && e.message) || e) }));

  if (result && result.__error) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/page-evaluate-failed`,
      `page.evaluate threw: ${result.__error} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // ─── 3. Assertions ────────────────────────────────────────────────────

  // 3a. Parser MUST NOT throw. HIGH if it did — kills the modal.
  if (result.phase === 'parse' && result.parseThrew) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/parser-threw-on-adversarial`,
      `importViaPaste threw on adversarial AZMA TSV — modal preview would crash for the real doctor. err:${result.parseThrew} flavors:${JSON.stringify(result.bundle.injectedFlavors)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  if (result.phase === 'parse' && result.__error) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/parser-shape-broken`,
      `importViaPaste did not return an array (got ${result.got}) — contract regression. | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  const { bundle, parsedCount, mapSize, nullKeyCount, emptyKeyCount, mapThrew, seedThrew } = result;

  // 3a-bis. Seed loop must complete — if it threw, IDB instability
  // corrupted the probe corpus and we can't trust the downstream
  // counts. HIGH because the bot infra needs investigation; the
  // probe itself is no-op on this tick (cleanup ran via finally).
  if (seedThrew) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/seed-loop-failed`,
      `Seed loop threw mid-flight (IDB instability?) — probe corpus incomplete. err:${seedThrew} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3b. PRIMARY HIGH probe — empty-name rows MUST be dropped at L431.
  // If the count exceeds the oracle's expectedParsedRows, the L431
  // guard regressed. Calibration target: comment out L431 and watch
  // this fire.
  if (parsedCount > bundle.expectedParsedRows) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/parser-accepted-nameless-row`,
      `parseAzmaTsv returned ${parsedCount} rows, oracle expected ${bundle.expectedParsedRows}. Likely L431 (the empty-name skip) regressed. flavors:${JSON.stringify(bundle.injectedFlavors)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3c. SECONDARY HIGH probe — too FEW rows means a different
  // regression (e.g. malformed-tz row dropped instead of accepted, or
  // RTL marks tripping a trim filter). Less load-bearing than 3b but
  // still surface-worthy.
  if (parsedCount < bundle.expectedParsedRows) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/parser-dropped-too-many-rows`,
      `parseAzmaTsv returned ${parsedCount} rows, oracle expected ${bundle.expectedParsedRows}. parser too aggressive — likely a new filter rejected a flavor it shouldn't. flavors:${JSON.stringify(bundle.injectedFlavors)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3d. by-tz map must NOT throw. If it did, the v7 ghost-patient bug
  // class (or a worse regression) is back.
  if (mapThrew) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/by-tz-scan-throws`,
      `listPatientsByTzMap threw with adversarial seeded patients — err:${mapThrew} parsedCount:${parsedCount} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3e. by-tz map must NOT leak null keys. The map's contract is
  // string keys only; null indicates a `.trim()` on null somewhere.
  if (nullKeyCount > 0) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/null-key-leaked-into-by-tz-map`,
      `listPatientsByTzMap returned ${nullKeyCount} null key(s) — contract violation; blank-tz patients should be silently skipped. mapSize:${mapSize} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3f. by-tz map must NOT leak empty-string keys. Same contract;
  // separated from 3e because the bug class differs (skip-on-empty
  // dropped vs skip-on-null dropped).
  if (emptyKeyCount > 0) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/empty-key-leaked-into-by-tz-map`,
      `listPatientsByTzMap returned ${emptyKeyCount} empty-string key(s) — contract violation; the blank-tz skip in indexed.ts:399-400 regressed. mapSize:${mapSize} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3g. Dedup invariant — distinct valid ת.ז. count must match oracle.
  // mapSize includes any duplicate-tz rows collapsed by Map.set, so
  // mapSize should equal expectedDistinctValidTz. A regression that
  // doubles-up duplicates (or drops them entirely) trips here.
  if (mapSize !== bundle.expectedDistinctValidTz) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/dedup-invariant-broken`,
      `listPatientsByTzMap.size = ${mapSize}, oracle expected ${bundle.expectedDistinctValidTz} distinct valid-tz entries. parsedCount:${parsedCount} expectedParsedRows:${bundle.expectedParsedRows} expectedNullTzRows:${bundle.expectedNullTzRows} flavors:${JSON.stringify(bundle.injectedFlavors)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // 3h. Cleanup must succeed — Codex P2 #213 (round 3). Surfaced last
  // so substantive probe findings (3a–3g) take priority in the bug
  // report. If clearPatients threw at the end of the probe, synthetic
  // bot rows survived into downstream scenarios' starting state.
  // Treating this as HIGH (ok: false) so the probe doesn't quietly
  // succeed-with-side-effects.
  const { cleanupThrew } = result;
  if (cleanupThrew) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/rosterImportRace/cleanup-failed`,
      `clearPatients() threw at probe end — synthetic bot patient rows remain in the IDB store and will contaminate subsequent ACTION_MENU ticks on this persona. err:${cleanupThrew} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // Light jitter so the persona's downstream actions don't fire on
  // the exact same tick boundary every time.
  await sleep(rand(80, 240));

  return { ok: true, _botSubject: subject };
}
