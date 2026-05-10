/**
 * subBotsV4.mjs — four new sub-bots covering flows that were never bot-tested.
 *
 *   1. scenEmailToSelf — /save → "✉ מייל מהמכשיר" (mailto) +
 *      "✉ שלח במייל (Gmail)" (proxy POST). Pre-populates sessionStorage
 *      with a synthetic note + clicks Save first to reach the done state
 *      where the email buttons render.
 *
 *   2. scenMorningRoundsPrep — sets localStorage.lastArchivedDate to a
 *      past date so MorningArchivePrompt fires, then exercises the
 *      ארכב/דחה/ארכב-שוב flow.
 *
 *   3. scenResetPasswordLanding — visits #/reset-password with empty,
 *      malformed, and well-formed-but-fake tokens; asserts the token
 *      error UI surfaces specific messages and the "חזרה להתחברות"
 *      button works.
 *
 *   4. scenOrthoCalcMath — sets the date input to today-7d, asserts
 *      POD: 7 in DOM text, suture-date math, DVT renal-state output.
 *
 * Per Web-Claude lesson: every selector is a named aria-label or text
 * pattern — NO `nth(random)`. Every flag carries `_botSubject` for the
 * post-run precision analyzer.
 */

import { sleep, rand, safeClick, safeFill, findByText, personaSleep, waitForSubject } from './megaPersona.mjs';

// ─── 1. Email-to-self ──────────────────────────────────────────────────────

export async function scenEmailToSelf(page, _browser, scenario, persona, guard, _reportDir, logBug) {
  const subject = 'emailToSelf';
  // Reset to a clean state — /save with no body would refuse to save.
  // Pre-populate sessionStorage with a synthetic note so the Save button
  // can complete and the email buttons render in the done state.
  await page.evaluate((scen) => {
    try {
      const fakeValidated = {
        name: scen.demographics?.name_he || 'מטופל בדיקה',
        teudatZehut: scen.demographics?.tz || '111111111',
        age: scen.demographics?.age || 80,
      };
      sessionStorage.setItem('noteType', 'admission');
      sessionStorage.setItem('validated', JSON.stringify(fakeValidated));
      sessionStorage.setItem('body', `S: ${scen.chief_complaint || 'בדיקת זרימת אימייל'}\nO: bot test\nA: bot test\nP: bot test`);
    } catch (_) {}
  }, scenario).catch(() => {});

  await page.evaluate(() => { window.location.hash = '#/save'; });
  await personaSleep(persona);

  // V4.1 — wait for Save screen to mount before any innerText reads.
  // Without this, evaluate() races React render and finds nothing useful.
  const wait = await waitForSubject(page, [
    /^שמירה$/,        // section heading on /save
    /^שמור$/,         // Save button
    /^נשמר ✓$/,       // already-done state
  ], 5000);
  if (!wait.ok) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/emailToSelf/mount-timeout`,
      `Save screen did not render in 5s | _botSubject:${subject}`);
    return { ok: false };
  }

  // Click Save (text "שמור").
  const saveBtn = await findByText(page, [/^שמור$/, /^שומר/]);
  if (!saveBtn) {
    logBug('LOW', scenario.scenario_id, `${persona.name}/emailToSelf/no-save-btn`,
      `Save button not found on /save | _botSubject:${subject}`);
    return { ok: false };
  }
  const saveResult = await safeClick(page, persona, saveBtn, 'save', guard);
  if (!saveResult.ok) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/emailToSelf/save-failed`,
      `Save click failed: ${saveResult.error || 'missclick'} | _botSubject:${subject}`);
    return { ok: false };
  }

  // Wait for the "נשמר ✓" done state (or error).
  let done = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const sig = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        done: /נשמר ✓/.test(txt),
        error: /^שגיאה$/m.test(txt),
      };
    }).catch(() => ({ done: false, error: false }));
    if (sig.done) { done = true; break; }
    if (sig.error) {
      logBug('MEDIUM', scenario.scenario_id, `${persona.name}/emailToSelf/save-error`,
        `Save returned error state | _botSubject:${subject}`);
      return { ok: false };
    }
  }
  if (!done) {
    logBug('HIGH', scenario.scenario_id, `${persona.name}/emailToSelf/save-timeout`,
      `Save did not reach done state in 10s | _botSubject:${subject}`);
    return { ok: false };
  }

  // Try the "✉ מייל מהמכשיר" (mailto:) button.
  const mailtoBtn = await findByText(page, [/✉ מייל מהמכשיר/]);
  if (mailtoBtn) {
    const r = await safeClick(page, persona, mailtoBtn, 'email-mailto', guard);
    if (!r.ok) {
      logBug('MEDIUM', scenario.scenario_id, `${persona.name}/emailToSelf/mailto-click-failed`,
        `mailto button click failed: ${r.error || 'missclick'} | _botSubject:${subject}`);
    }
  } else {
    // emailTarget unset → button doesn't render. Bot's init-script sets it,
    // so missing button is itself a regression.
    logBug('HIGH', scenario.scenario_id, `${persona.name}/emailToSelf/mailto-missing`,
      `מייל מהמכשיר button missing despite emailTarget being set | _botSubject:${subject}`);
  }

  // Try the "✉ שלח במייל (Gmail)" button (proxy POST path — may 503 if
  // RESEND_API_KEY not configured; should surface specific Hebrew error,
  // not silent fail).
  const gmailBtn = await findByText(page, [/^✉ שלח במייל \(Gmail\)$/, /^נסה שוב — שלח במייל$/]);
  if (gmailBtn) {
    const r = await safeClick(page, persona, gmailBtn, 'email-gmail', guard);
    if (r.ok) {
      // Wait briefly for sendStatus to settle.
      await sleep(2500);
      const surfaced = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        return {
          sent: /✉ נשלח ל-/.test(txt),
          err: /שגיאה בשליחה|email_not_configured|503/.test(txt),
        };
      }).catch(() => ({ sent: false, err: false }));
      if (!surfaced.sent && !surfaced.err) {
        logBug('MEDIUM', scenario.scenario_id, `${persona.name}/emailToSelf/silent-fail`,
          `Gmail send button click left no visible status (sent or err) | _botSubject:${subject}`);
      }
    }
  }

  return { ok: true, _botSubject: subject };
}

// ─── 2. Morning rounds prep ────────────────────────────────────────────────

export async function scenMorningRoundsPrep(page, _browser, scenario, persona, guard, _reportDir, logBug) {
  const subject = 'morningRoundsPrep';

  // Force the banner to fire by setting lastArchivedDate to yesterday.
  await page.evaluate(() => {
    try {
      const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString('en-CA');
      localStorage.setItem('ward-helper.lastArchivedDate', yesterday);
      // Clear the dismissed flag for today so banner shows.
      const today = new Date().toLocaleDateString('en-CA');
      sessionStorage.removeItem(`ward-helper.bannerDismissed_${today}`);
    } catch (_) {}
  }).catch(() => {});

  await page.evaluate(() => { window.location.hash = '#/today'; });
  await sleep(rand(800, 1500));

  // V4.1 — wait for /today to mount AND the banner effect to fire (the
  // MorningArchivePrompt useEffect runs on mount and checks lastArchivedDate;
  // we set yesterday above, so the banner should appear). Without this
  // ratchet, evaluate races useEffect and reports banner-missing falsely.
  const wait = await waitForSubject(page, [
    /זוהה יום חדש/,        // banner text
    /כבר ארכבת היום/,      // confirm-replace state
    /^ארכב$/,              // archive button
    /^דחה$/,              // dismiss button
    /היום אין מטופלים/,   // empty-roster fallback (banner WILL render but list-section text)
  ], 5000);
  // Note: a no-banner result is itself a valid signal — don't bail on
  // wait failure here; let the next check distinguish "banner truly missing"
  // from "wait helper timed out".
  if (!wait.ok) {
    // page didn't render anything in 5s — different bug class than missing banner
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/morningRounds/mount-timeout`,
      `/today did not render any expected content in 5s | _botSubject:${subject}`);
    return { ok: false };
  }

  // Look for the banner — text "זוהה יום חדש" or button "ארכב".
  const bannerVisible = await page.evaluate(() => {
    return /זוהה יום חדש|כבר ארכבת היום/.test(document.body.innerText || '');
  }).catch(() => false);

  if (!bannerVisible) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/morningRounds/banner-missing`,
      `MorningArchivePrompt banner did not render despite lastArchivedDate set to yesterday | _botSubject:${subject}`);
    return { ok: false };
  }

  // Half the time exercise "דחה" (dismiss), half exercise "ארכב" (archive).
  const archive = Math.random() < 0.5;
  const target = archive
    ? await findByText(page, [/^ארכב$/, /^ארכב שוב$/])
    : await findByText(page, [/^דחה$/, /^בטל$/]);

  if (!target) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/morningRounds/btn-missing`,
      `expected ${archive ? 'ארכב' : 'דחה'} button on banner | _botSubject:${subject}`);
    return { ok: false };
  }

  const r = await safeClick(page, persona, target, archive ? 'archive-day' : 'dismiss-banner', guard);
  if (!r.ok) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/morningRounds/click-failed`,
      `${archive ? 'archive' : 'dismiss'} click failed: ${r.error || 'missclick'} | _botSubject:${subject}`);
    return { ok: false };
  }

  await sleep(rand(800, 1500));

  if (archive) {
    // After archive, banner should disappear OR enter confirm-replace state.
    const post = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        gone: !/זוהה יום חדש/.test(txt),
        confirmReplace: /כבר ארכבת היום/.test(txt),
        archiveErr: /נכשל בארכוב/.test(txt),
      };
    }).catch(() => ({ gone: false, confirmReplace: false, archiveErr: false }));
    if (post.archiveErr) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/morningRounds/archive-failed`,
        `archiveDay surfaced "נכשל בארכוב" error | _botSubject:${subject}`);
    } else if (!post.gone && !post.confirmReplace) {
      logBug('MEDIUM', scenario.scenario_id, `${persona.name}/morningRounds/banner-stuck`,
        `archive clicked but banner still visible | _botSubject:${subject}`);
    }
  }

  return { ok: true, _botSubject: subject };
}

// ─── 3. Reset-password landing ─────────────────────────────────────────────

export async function scenResetPasswordLanding(page, _browser, scenario, persona, guard, _reportDir, logBug) {
  const subject = 'resetPasswordLanding';

  // Three scenarios: empty token, malformed token, well-formed-fake token.
  const cases = [
    { hash: '#/reset-password', label: 'empty', expectMsg: /הקישור לא תקין — חסר token/ },
    { hash: '#/reset-password?token=', label: 'empty-param', expectMsg: /הקישור לא תקין — חסר token/ },
    { hash: '#/reset-password?token=abc', label: 'short-malformed', expectMsg: null /* form should render; submit fail */ },
    { hash: `#/reset-password?token=${'a'.repeat(64)}`, label: 'fake-good-shape', expectMsg: null },
  ];
  const pick = cases[Math.floor(Math.random() * cases.length)];

  await page.evaluate((h) => { window.location.hash = h.replace(/^#/, ''); window.location.hash = h; }, pick.hash);
  await sleep(rand(800, 1500));

  // V4.1 — wait for React to mount the page before reading body text.
  // Without this ratchet the v4 run produced 88 HIGH false-positives
  // (`empty-msg-missing`) because the evaluate ran before <PasswordReset>
  // rendered. Wait for any of: form (token cases), empty-token banner
  // (no-token cases), or the back-to-login button (also empty cases).
  const wait = await waitForSubject(page, [
    'input[type="password"]',
    /הקישור לא תקין/,
    /חזרה להתחברות/,
  ], 5000);
  if (!wait.ok) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/resetPassword/mount-timeout`,
      `${pick.label}: PasswordReset did not render in 5s | _botSubject:${subject}`);
    return { ok: false };
  }

  // For the empty-token cases: assert the documented error message + button.
  if (pick.expectMsg) {
    const surfaced = await page.evaluate((re) => {
      try {
        return new RegExp(re).test(document.body.innerText || '');
      } catch (_) { return false; }
    }, pick.expectMsg.source).catch(() => false);
    if (!surfaced) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/resetPassword/empty-msg-missing`,
        `${pick.label}: expected "הקישור לא תקין — חסר token" not surfaced | _botSubject:${subject}`);
    }
    // Click the back-to-login button.
    const back = await findByText(page, [/חזרה להתחברות/]);
    if (back) await safeClick(page, persona, back, 'reset-back', guard);
    return { ok: true, _botSubject: subject, case: pick.label };
  }

  // For the form cases: fill both inputs (matching), submit, expect a token
  // error — should NOT silently navigate elsewhere.
  const pwd = page.locator('input[type="password"]').first();
  const pwd2 = page.locator('input[type="password"]').nth(1);
  if ((await pwd.count().catch(() => 0)) === 0) {
    logBug('HIGH', scenario.scenario_id, `${persona.name}/resetPassword/no-form`,
      `${pick.label}: token present but form did not render | _botSubject:${subject}`);
    return { ok: false };
  }
  await safeFill(page, persona, pwd, 'TestPass123!', guard);
  await safeFill(page, persona, pwd2, 'TestPass123!', guard);
  const submit = await findByText(page, [/^🔐 אפס סיסמה$/, /^מאפס…$/]);
  if (submit) {
    await safeClick(page, persona, submit, 'reset-submit', guard);
    await sleep(2500);
    // Expect EITHER a token error message OR a network error — not silent.
    const post = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        hasErrMsg: /הקישור לא תקין|הקישור הזה כבר נוצל|הקישור פג תוקף|בעיית רשת|שגיאת שרת|שגיאה/.test(txt),
        wentToOk: /הסיסמה אופסה/.test(txt),
      };
    }).catch(() => ({ hasErrMsg: false, wentToOk: false }));
    if (!post.hasErrMsg && !post.wentToOk) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/resetPassword/silent-on-fake-token`,
        `${pick.label}: submit with fake token left no status banner | _botSubject:${subject}`);
    }
    if (post.wentToOk && pick.label !== 'unexpected') {
      logBug('CRITICAL', scenario.scenario_id, `${persona.name}/resetPassword/fake-token-accepted`,
        `${pick.label}: server accepted a fake token (CRITICAL — auth bypass) | _botSubject:${subject}`);
    }
  }

  return { ok: true, _botSubject: subject, case: pick.label };
}

// ─── 4. Ortho calc math (POD + suture date + DVT) ─────────────────────────

export async function scenOrthoCalcMath(page, _browser, scenario, persona, guard, _reportDir, logBug) {
  const subject = 'orthoCalcMath';

  await page.evaluate(() => { window.location.hash = '#/ortho'; });
  await personaSleep(persona);

  // V4.1 — wait for OrthoQuickref to mount before reading. Without this
  // ratchet the v4 run produced 107 HIGH false-positives (`no-date-input`)
  // because the evaluate ran before React rendered the <input type=date>.
  const wait = await waitForSubject(page, [
    'input[type="date"][aria-label*="תאריך ניתוח"]',
    /אורתו - מדריך מהיר/,
  ], 5000);
  if (!wait.ok) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/orthoCalcMath/mount-timeout`,
      `OrthoQuickref did not render in 5s | _botSubject:${subject}`);
    return { ok: false };
  }

  // Compute today - 7 days as YYYY-MM-DD.
  const sevenAgo = new Date(Date.now() - 7 * 86400_000);
  const iso = sevenAgo.toISOString().slice(0, 10);

  // Fill the date input (aria-label="תאריך ניתוח").
  const dateInput = page.locator('input[type="date"][aria-label*="תאריך ניתוח"]').first();
  if ((await dateInput.count().catch(() => 0)) === 0) {
    logBug('HIGH', scenario.scenario_id, `${persona.name}/orthoCalcMath/no-date-input`,
      `surgery date input missing | _botSubject:${subject}`);
    return { ok: false };
  }
  await dateInput.fill(iso, { timeout: 3000 }).catch(() => {});
  await sleep(500);

  // Read DOM text and assert POD output.
  const podText = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/POD:\s*(\d+)/);
    return m ? m[1] : null;
  }).catch(() => null);

  if (podText === null) {
    logBug('HIGH', scenario.scenario_id, `${persona.name}/orthoCalcMath/no-pod-output`,
      `surgery date set to today-7d but no "POD: N" text rendered | _botSubject:${subject}`);
  } else if (Number(podText) !== 7) {
    logBug('CRITICAL', scenario.scenario_id, `${persona.name}/orthoCalcMath/pod-wrong`,
      `surgery date today-7d → expected POD 7, got POD ${podText} | _botSubject:${subject}`);
  }

  // Read suture date output: text "להוצאה תאריך DD/MM/YY (POD <n>)"
  const sutureMatch = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/להוצאה תאריך\s*(\d{2}\/\d{2}\/\d{2})\s*\(POD\s*(\d+)\)/);
    return m ? { date: m[1], pod: Number(m[2]) } : null;
  }).catch(() => null);

  if (!sutureMatch) {
    logBug('HIGH', scenario.scenario_id, `${persona.name}/orthoCalcMath/no-suture-output`,
      `suture removal output missing despite valid date | _botSubject:${subject}`);
  } else {
    // Default site is 'hip' which expects POD ~14 (range varies by modifier).
    // Without modifiers, POD should be in range 12-16 for a hip site.
    if (sutureMatch.pod < 7 || sutureMatch.pod > 30) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/orthoCalcMath/suture-pod-out-of-range`,
        `hip site, no modifiers → suture POD ${sutureMatch.pod}, expected 7-30 | _botSubject:${subject}`);
    }
  }

  // DVT: with renalState=normal the line should mention Enoxaparin/LMWH.
  const dvtText = await page.evaluate(() => {
    // The DVT prophylaxis fieldset contains a <p> after the radiogroup.
    const ps = Array.from(document.querySelectorAll('fieldset p'));
    return ps.map((p) => p.textContent || '').join(' ').slice(0, 1000);
  }).catch(() => '');

  if (dvtText && !/Enoxaparin|LMWH|פרופילקס|Heparin|Fondaparinux|Dalteparin/i.test(dvtText)) {
    logBug('MEDIUM', scenario.scenario_id, `${persona.name}/orthoCalcMath/dvt-text-suspicious`,
      `DVT prophylaxis text mentions no expected drug class: "${dvtText.slice(0, 120)}" | _botSubject:${subject}`);
  }

  // Test renal-state change: switch to "המודיאליזה" radio.
  const hdRadio = page.locator('input[type="radio"][name="renalState"][value="hd"]').first();
  if ((await hdRadio.count().catch(() => 0)) > 0) {
    await hdRadio.click({ timeout: 2000 }).catch(() => {});
    await sleep(400);
    const dvtTextHd = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('fieldset p'));
      return ps.map((p) => p.textContent || '').join(' ');
    }).catch(() => '');
    // On HD, Enoxaparin should NOT be the first-line — should mention IPC,
    // Heparin SC, or HD-specific guidance.
    if (dvtTextHd && /Enoxaparin\s*40\s*mg/i.test(dvtTextHd)) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/orthoCalcMath/dvt-hd-wrong-drug`,
        `renalState=HD still suggests Enoxaparin 40mg (CrCl-blind) | _botSubject:${subject}`);
    }
  }

  return { ok: true, _botSubject: subject, podGot: podText };
}
