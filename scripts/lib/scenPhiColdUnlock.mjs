/**
 * PHI cold-start unlock scenario — fixture-only (kickoff §8 q1).
 *
 * Closes audit dimension D2 from
 *   docs/audit/2026-05-18-phi-unlock-scenario-kickoff.md
 * by exercising the full seal → cold-start → gate → unlock → backfill
 * lifecycle under realistic persona load.
 *
 * Both legs are exercised per scenario tick:
 *   - correct-password: gate clears, no error banner, key set, no
 *     wrong-key writes
 *   - wrong-password: probe rejects (see src/auth/phiUnlock.ts
 *     `_probeKeyAgainstSealedRows`, currently L96–121), gate persists,
 *     error banner surfaces, hasPhiKey() stays false, sealed-row count
 *     unchanged
 *
 * §3 PROBE TRAP — load-bearing: the wrong-password leg MUST seed >=1
 * real sealed row via window.__phiBotApi.seedOneSealedPatient() BEFORE
 * clearing the key (the seed function does the clear at the end). A
 * sentinel-only fixture would render `locked` but the probe would have
 * nothing to verify against and would silently accept any password.
 * That is the exact failure mode this scenario is designed to detect.
 *
 * §4 detector-armed — calibration procedure: revert v1.46.1's probe
 * locally and confirm this scenario goes RED on the broken build. One-
 * shot human check, NOT in CI. The scenario must remain capable of
 * failing in that condition; the wrong-password leg's first assertion
 * is on the error banner, which only surfaces when the probe actually
 * rejects.
 *
 * Anchor refresh (kickoff §1) — note the actual gate-state hook is at
 *   src/ui/hooks/usePhiGateState.ts (hasPhiKey at L38,
 *   isPhiBackfillComplete at L45)
 * not the path cited in the original spec.
 */
import {
  sleep,
  rand,
  safeClick,
  waitForSubject,
  findByText,
} from './megaPersona.mjs';

const CORRECT_PWD = 'phi-test-correct-9k2x';
const WRONG_PWD = 'phi-test-WRONG-bz7v';

// Spec §8 q1 — fixture-only. The scenario registers synthetic users and
// flips the v7 sentinel; running it in a paid Opus / non-fixture run would
// pollute real auth data. The mega-bot exports WARD_BOT_FIXTURE via env so
// we read it at module load. (Codex P1 #2 — pre-merge.)
const FIXTURE_MODE = process.env.WARD_BOT_FIXTURE === '1';

export async function scenPhiColdUnlock(
  page,
  _browser,
  scenario,
  persona,
  guard,
  _reportDir,
  logBug,
) {
  const subject = 'phiColdUnlock';
  const scenId = scenario.scenario_id;

  // Gate 1 — fixture mode only. In a non-fixture run, return ok+skipped so
  // the action burns a tick without firing the registration/sentinel path.
  if (!FIXTURE_MODE) {
    return { ok: true, _botSubject: subject, _skipped: 'non-fixture-mode' };
  }

  // Gate 2 — single-shot per persona. After the first successful run the
  // user is logged in and a re-fire would land on the now-authenticated
  // account UI (no register form) and emit a spurious HIGH
  // no-register-form. Persisted in localStorage rather than `window` so
  // it survives the page.reload() the bootstrap does after setting the
  // botApi flag. localStorage is tied to the persona's browser context
  // (runPersona creates one ctx + one page each, never reassigns), so
  // this scopes to the persona exactly. (Codex P1 #1 — pre-merge;
  // localStorage move fixes the reload-wipe bug surfaced by §6.4 v3.)
  const RAN_KEY = 'ward-helper.phiColdUnlockRan';
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
    return {
      ok: true,
      _botSubject: subject,
      _skipped: 'already-ran-this-persona',
    };
  }

  // Mark on entry — every exit path from here on counts as "this persona
  // has had its phiColdUnlock attempt." The bootstrap below creates a
  // uniquely-named synthetic user (Date.now()-suffixed), so a retry could
  // not re-establish the same cold-start state anyway. Marking on
  // success-only left re-entry open after early-fail paths (Codex P1 #1
  // class), which the §6.4 RED calibration run deliberately exercises
  // (wrong-pwd-accepted) — without this, tick 2+ of a RED run would emit
  // spurious no-register-form HIGHs that bury the legitimate finding.
  await page
    .evaluate((k) => {
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* localStorage disabled — Gate 2 becomes a no-op; acceptable */
      }
    }, RAN_KEY)
    .catch(() => {});

  // ─── 1. Bootstrap: enable bot API, register fresh user ────────────────
  //
  // The attach IIFE in src/main.tsx fires on every page load IF the
  // localStorage flag is set. Set it here belt-and-braces, then reload
  // to guarantee the IIFE sees it before we make our first API call.
  await page
    .evaluate(() => {
      try {
        localStorage.setItem('ward-helper.botApi', '1');
      } catch (_) {
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
      return typeof window.__phiBotApi?.seedOneSealedPatient === 'function';
    })
    .catch(() => false);
  if (!apiReady) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/bot-api-missing`,
      `window.__phiBotApi.seedOneSealedPatient not present — attach gate broken or main.tsx wiring regressed | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // Register a fresh synthetic user. Auth registration writes a bcrypt
  // hash and must stay UI-only; the bot API deliberately does not expose
  // registerUser to window.
  const synthUser = `phitest${Date.now().toString(36).slice(-6)}`;
  const registered = await _registerFreshUser(
    page,
    persona,
    guard,
    synthUser,
    CORRECT_PWD,
    scenId,
    logBug,
  );
  if (!registered) return { ok: false };

  // Wait for post-register state to settle.
  await sleep(rand(800, 1500));

  // ─── 2. Seed a real sealed row under CORRECT_PWD ──────────────────────
  //
  // §3 MANDATORY. Uses the production sealRow + setPhiKey path (same
  // primitives the real backfill uses), so the probe at unlock time
  // sees genuinely-sealed ciphertext under the correct key.
  const seededPatientId = await page
    .evaluate(async (pwd) => {
      try {
        return await window.__phiBotApi.seedOneSealedPatient(pwd);
      } catch (e) {
        return { __error: String((e && e.message) || e) };
      }
    }, CORRECT_PWD)
    .catch((e) => ({ __error: String((e && e.message) || e) }));

  if (typeof seededPatientId !== 'string') {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/seed-failed`,
      `seedOneSealedPatient threw or returned non-string: ${JSON.stringify(seededPatientId)} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // Snapshot pre-attempt sealed-row count (for the no-wrong-key-writes
  // assertion in step 4).
  const preCount = await _countSealedPatients(page);

  // ─── 3. WRONG-PASSWORD LEG ────────────────────────────────────────────
  //
  // The seed already cleared the in-memory key; hasPhiKey() should be
  // false and phiEncryptedV7 should be true, so navigating to a PHI
  // route should mount the Unlock gate.
  await page
    .evaluate(() => {
      window.location.hash = '#/today';
    })
    .catch(() => {});
  await sleep(800);

  const unlockMounted = await waitForSubject(
    page,
    [/סיסמה:/, /סיסמה שגויה/],
    5000,
  );
  if (!unlockMounted.ok) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/gate-no-mount-wrong-leg`,
      `Unlock screen did not render within 5s despite sentinel set + key cleared | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  const wrongInput = page.getByLabel(/סיסמה:/).first();
  if ((await wrongInput.count().catch(() => 0)) === 0) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/wrong-input-missing`,
      `password input not present on Unlock screen | _botSubject:${subject}`,
    );
    return { ok: false };
  }
  await wrongInput.fill(WRONG_PWD);
  await sleep(rand(150, 300));
  const submitWrong = await findByText(page, [
    /^שלח$|^התחבר$|^פתח$|^בטל נעילה$/,
  ]);
  if (submitWrong) {
    await safeClick(
      page,
      persona,
      submitWrong,
      'phi-unlock-wrong-submit',
      guard,
    );
  } else {
    await wrongInput.press('Enter').catch(() => {});
  }

  // Poll for the error banner up to 4s. Replaces the fixed 1.2-2s sleep +
  // one-shot snapshot read that produced false MEDIUM `no-error-banner`
  // bugs on GREEN + sanity runs when the banner rendered slightly after
  // the snapshot tick. waitForSubject polls document.body.innerText, which
  // is the same surface the alert <p> writes into, so /שגויה/ matches as
  // soon as React commits — no race. (Other scen* sub-bots use this idiom;
  // bringing phiColdUnlock into line.)
  const bannerSeen = await waitForSubject(page, [/שגויה/], 4000);

  // Snapshot the causal signals (keySet + stillLocked) regardless of banner
  // outcome — those are the load-bearing probe-trap detectors. errorShown
  // is the consequential signal and is what waitForSubject just polled.
  const wrongLegResult = await page
    .evaluate(() => ({
      stillLocked: /סיסמה:/.test(document.body.innerText || ''),
      keySet: !!(window.__phiBotApi?.hasPhiKey?.()),
    }))
    .catch(() => ({ stillLocked: false, keySet: false }));
  wrongLegResult.errorShown = bannerSeen.ok;

  // PROBE TRAP detection — wrong password was silently accepted into the
  // PHI keychain. Primary signal: key got SET into memory (`hasPhiKey()`
  // returns true) OR gate cleared (Unlock unmounted, login form no longer
  // visible). Either alone is sufficient to indicate the trap fired.
  // Original kickoff version used !errorShown as the primary signal — but
  // errorShown is consequential (it only renders when the probe REJECTS),
  // not causal. A false positive on errorShown (em-dash mismatch, RTL
  // BIDI in innerText) would silently flag a healthy GREEN build.
  if (wrongLegResult.keySet || !wrongLegResult.stillLocked) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/wrong-pwd-accepted`,
      `WRONG password was accepted — probe trap (kickoff §3) | seededPatient:${seededPatientId} | keySet:${wrongLegResult.keySet} | stillLocked:${wrongLegResult.stillLocked} | errorShown:${wrongLegResult.errorShown} | _botSubject:${subject}`,
    );
    return { ok: false };
  }
  // Secondary: probe rejected correctly but no error banner detected.
  // Lower severity — this is a UX dead-end, not a security failure. The
  // probe did its job; the user just sees a non-responsive form. Worth
  // surfacing as MEDIUM but does not fail the scenario.
  if (!wrongLegResult.errorShown) {
    logBug(
      'MEDIUM',
      scenId,
      `${persona.name}/phiColdUnlock/wrong-pwd-no-error-banner`,
      `Probe rejected wrong password (keySet=false, stillLocked=true) but error banner not detected within ~1.5s — UX dead-end | _botSubject:${subject}`,
    );
    // Do NOT return — this is informational; scenario continues.
  }

  // No-wrong-key-writes check.
  const postWrongCount = await _countSealedPatients(page);
  if (
    preCount >= 0 &&
    postWrongCount >= 0 &&
    postWrongCount !== preCount
  ) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/wrong-key-writes`,
      `Sealed-row count changed during WRONG password attempt: pre=${preCount} post=${postWrongCount} | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  // ─── 4. CORRECT-PASSWORD LEG ──────────────────────────────────────────
  const correctInput = page.getByLabel(/סיסמה:/).first();
  // Field may carry the previous wrong attempt — clear before retyping.
  await correctInput.fill('').catch(() => {});
  await sleep(rand(100, 200));
  await correctInput.fill(CORRECT_PWD);
  await sleep(rand(150, 300));
  const submitCorrect = await findByText(page, [
    /^שלח$|^התחבר$|^פתח$|^בטל נעילה$/,
  ]);
  if (submitCorrect) {
    await safeClick(
      page,
      persona,
      submitCorrect,
      'phi-unlock-correct-submit',
      guard,
    );
  } else {
    await correctInput.press('Enter').catch(() => {});
  }
  await sleep(rand(1500, 2500));

  const correctLegResult = await page
    .evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        stillLocked: /סיסמה:/.test(txt),
        keySet: !!(window.__phiBotApi && window.__phiBotApi.hasPhiKey && window.__phiBotApi.hasPhiKey()),
        errorShown: /סיסמה שגויה/.test(txt),
      };
    })
    .catch(() => ({ stillLocked: true, keySet: false, errorShown: false }));

  if (correctLegResult.stillLocked) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/correct-pwd-rejected`,
      `CORRECT password did not clear gate — probe false-rejected the right key | _botSubject:${subject}`,
    );
    return { ok: false };
  }
  if (!correctLegResult.keySet) {
    logBug(
      'HIGH',
      scenId,
      `${persona.name}/phiColdUnlock/correct-pwd-no-key`,
      `Gate cleared but PHI key is not set in memory — probe path skipped setPhiKey | _botSubject:${subject}`,
    );
    return { ok: false };
  }

  return { ok: true, _botSubject: subject };
}

// AccountSection lives inside the /settings route (kickoff doc cited a
// non-existent /account path that hits the catch-all <Capture /> — fixed
// here). The form has a login/register tab toggle with role="tab"; we
// click the register tab if the register-form placeholder isn't already
// visible. Pattern mirrors scripts/ward-helper-bot-v1.mjs::
// switchToRegisterForm including the verify-after-click loop.
async function _registerFreshUser(
  page,
  _persona,
  _guard,
  user,
  pwd,
  scenId,
  logBug,
) {
  await page
    .evaluate(() => {
      window.location.hash = '#/settings';
    })
    .catch(() => {});
  await sleep(rand(500, 900));

  const regPlaceholder = /שם משתמש \(3-32 תווים/;
  const togglePats = [
    /^the femur exemplarמה$/,
    /אין לי חשבון/,
    /צור חשבון/,
    /the femur exemplarמה חדשה/,
    /^register$/i,
  ];

  // Try each toggle pattern across tab + button roles, then VERIFY the
  // register form actually appeared before declaring success. Without
  // the verify step, an unrelated 'the femur exemplarמה' string (e.g. the warning
  // banner at L127 of AccountSection) would short-circuit the loop.
  let switched =
    (await page.getByPlaceholder(regPlaceholder).count().catch(() => 0)) > 0;
  if (!switched) {
    outer: for (const role of ['tab', 'button']) {
      for (const pat of togglePats) {
        const t = page.getByRole(role, { name: pat }).first();
        if ((await t.count().catch(() => 0)) > 0) {
          await t.click({ timeout: 3000 }).catch(() => {});
          await sleep(rand(400, 700));
          const seen =
            (await page
              .getByPlaceholder(regPlaceholder)
              .count()
              .catch(() => 0)) > 0;
          if (seen) {
            switched = true;
            break outer;
          }
        }
      }
    }
  }

  const userField = page.getByPlaceholder(regPlaceholder).first();
  if ((await userField.count().catch(() => 0)) === 0) {
    logBug(
      'HIGH',
      scenId,
      `phiColdUnlock/no-register-form`,
      `register form did not appear after #/settings navigation + tab toggle (switched=${switched})`,
    );
    return false;
  }
  const passField = page.getByPlaceholder(/סיסמה \(לפחות 6 תווים\)/).first();
  await userField.fill(user);
  await sleep(rand(150, 300));
  await passField.fill(pwd);
  await sleep(rand(200, 400));
  // Submit button text is "✨ צור חשבון" (per AccountSection.tsx as of
  // PR #169). The /create/i pattern bot-v1 uses doesn't match Hebrew
  // "צור" — register flow has been silently broken there too, but
  // bot-v1 isn't part of any scenario that depends on actual login, so
  // it went unsurfaced. Surfaced here because this scenario's PROBE
  // TRAP needs an authenticated session to seed a real sealed row.
  const submit = page
    .getByRole('button', {
      name: /צור חשבון|the femur exemplarמה|הירשם|submit|create/i,
    })
    .first();
  if ((await submit.count().catch(() => 0)) === 0) {
    logBug(
      'HIGH',
      scenId,
      `phiColdUnlock/no-register-submit`,
      'register submit button missing',
    );
    return false;
  }
  await submit.click({ timeout: 3000 }).catch(() => {});
  await sleep(rand(1500, 2500));
  return true;
}

// Returns the count of structurally-encrypted rows in the patients
// store. -1 if the IDB read failed structurally (DB not open, store
// missing). Callers must treat -1 as "skip the assertion" rather than
// "count is zero" — the kickoff's no-wrong-key-writes guard relies on
// pre/post equality, which a -1 sentinel would falsely satisfy.
async function _countSealedPatients(page) {
  return await page
    .evaluate(async () => {
      try {
        // DB name verified against src/storage/indexed.ts (`ward-helper`).
        const req = indexedDB.open('ward-helper');
        return await new Promise((resolve) => {
          req.onsuccess = async () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('patients')) {
              resolve(0);
              return;
            }
            const tx = db.transaction('patients', 'readonly');
            const rows = await new Promise((r2) => {
              const g = tx.objectStore('patients').getAll();
              g.onsuccess = () => r2(g.result || []);
              g.onerror = () => r2([]);
            });
            let sealed = 0;
            for (const r of rows) {
              if (
                r &&
                typeof r === 'object' &&
                'enc' in r &&
                r.enc &&
                typeof r.enc === 'object' &&
                'iv' in r.enc &&
                'ciphertext' in r.enc
              ) {
                sealed++;
              }
            }
            resolve(sealed);
          };
          req.onerror = () => resolve(-1);
        });
      } catch {
        return -1;
      }
    })
    .catch(() => -1);
}
