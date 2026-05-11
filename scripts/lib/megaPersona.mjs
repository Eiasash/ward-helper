/**
 * Mega-bot persona library — 7 doctor personas + action menu + chaos
 * injectors + recovery layer.
 *
 * Each persona is a long-running browser context that picks weighted-random
 * actions from a menu every tick. The recovery layer wraps every action in
 * a try/catch and detects "stuck" states (no DOM activity, error pages,
 * blank screens) to either soft-restart (hash to /), hard-restart
 * (page.reload), or hard-kill (close context, orchestrator spawns fresh).
 *
 * Reuses v2 helpers: generatePatientChart, distortImage, attachDiagnostics.
 * Reuses v2 sub-bot patterns but does not import them — sub-bots are
 * single-shot, personas are continuous.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { devices } from 'playwright';
import { generatePatientChart, generateLabReportPng } from './azmaImage.mjs';
import { distortImage } from './distortImage.mjs';
import { attachDiagnostics } from './diagnostics.mjs';
// V4 modules — six new chaos types, four new sub-bots, three new personas,
// persona memory + min-coverage scheduler. Web-Claude pushback shaped the
// final selection (deferred exifRotation; replaced flat-throttle with ramped;
// dropped tabHopper for intermittentConnection; etc.).
import {
  chaosNetworkRamped,
  chaosIdbQuotaStress,
  chaosEdgeSwipeBack,
  chaosMidnightRollover,
  chaosMemoryPressure,
  chaosRandomClick,
} from './chaosV4.mjs';
import {
  scenEmailToSelf,
  scenMorningRoundsPrep,
  scenResetPasswordLanding,
  scenOrthoCalcMath,
} from './subBotsV4.mjs';
import {
  PERSONAS_V4,
  PersonaMemory,
} from './personasV4.mjs';

// V4.2 — bumped from v4.1.0 because the JSONL timeline now carries two new
// per-tick booleans (`waitForSubjectCalled`, `iterationCompleted`) and the
// analyzer asserts a per-sub-bot ratchet on top of them. This is a bug-stream
// characteristic change (a v4.2-against-v4.1 baseline comparison would
// otherwise mis-attribute the analyzer's new fail-loud exit code to an app
// regression). NOT tied to the app version trinity (package.json/sw.js/
// APP_VERSION are unchanged — this PR ships bot tooling only).
//
// V4.1 was: regex extractor + waitForSubject static ratchets + invariant test.
// V4.2 adds: runtime per-tick wait counter via page._v42WaitCount (reset at
// the top of each runPersona iteration; incremented by waitForSubject; read
// into the onTick payload) + analyzer assertion gated to V4_SUB_BOTS_REQUIRING_WAIT.
export const BOT_VERSION = 'v4.2.0';

// ============================================================================
// Persona definitions — timing + tolerance + action-menu weights
// ============================================================================

export const PERSONAS = {
  // Real doctor patterns:
  speedrunner: {
    name: 'Dr. Speedrunner',
    minDelay: 60, maxDelay: 220,
    missclickRate: 0.02,
    typingSpeed: 'fast',         // ms per char
    description: 'attendings on rounds — fast taps, no reading, occasional mis-tap',
  },
  methodical: {
    name: 'Dr. Methodical',
    minDelay: 1200, maxDelay: 3500,
    missclickRate: 0.0,
    typingSpeed: 'slow',
    description: 'careful entry, reads every banner, slow but accurate',
  },
  misclicker: {
    name: 'Dr. Misclicker',
    minDelay: 400, maxDelay: 1500,
    missclickRate: 0.20,        // 20% miss rate — recovery layer must absorb
    typingSpeed: 'normal',
    description: 'fat-finger taps, off-center clicks, near-but-wrong targets',
  },
  multitasker: {
    name: 'Dr. Multitasker',
    minDelay: 300, maxDelay: 900,
    missclickRate: 0.05,
    typingSpeed: 'fast',
    description: 'switches between admission/SOAP/consult mid-flow, triggers visibilitychange',
    extraChaosRate: 0.30,       // 30% extra chaos events
  },
  keyboardWarrior: {
    name: 'Dr. Keyboard',
    minDelay: 500, maxDelay: 1800,
    missclickRate: 0.0,
    typingSpeed: 'normal',
    description: 'Tab + Enter only, no mouse — exposes a11y / keyboard-only paths',
    keyboardOnly: true,
  },
  batterySaver: {
    name: 'Dr. Battery-Saver',
    minDelay: 800, maxDelay: 2200,
    missclickRate: 0.03,
    typingSpeed: 'normal',
    description: 'phone goes to sleep — fires visibilitychange / pagehide / pageshow',
    sleepCycleEvery: 8,         // every 8 actions, simulate phone sleep
  },
  unicodeChaos: {
    name: 'Dr. Unicode',
    minDelay: 300, maxDelay: 1200,
    missclickRate: 0.05,
    typingSpeed: 'normal',
    description: 'types every kind of Hebrew + English + emoji + RLM/LRM mix',
    chaosTextRate: 0.50,
  },
  // V4 personas — replace the 3 duplicates in DEFAULT_PERSONA_ROTATION.
  ...PERSONAS_V4,
};

// ============================================================================
// Selector REGISTRY — every Hebrew button label, with multiple fallbacks
// ============================================================================

export const SEL = {
  // Capture screen
  proceedToReview: [/המשך לבדיקה/, /continue/i],
  imageInput: 'input[type="file"][accept^="image"]',
  pdfInput: 'input[type="file"][accept*="pdf"]',
  // Review screen
  perFieldConfirm: [/אישור ידני נדרש/],
  generateNoteList: [/צור טיוטת רשימה/, /generate/i],
  backToCapture: [/חזרה לצילום/],
  // NoteEditor screen
  copyAll: [/העתק הכל/],
  copySection: [/^📋 העתק$/, /^העתק$/],
  proceedToSave: [/המשך לשמירה/],
  // Save screen
  saveBtn: [/^שמור$/, /^שומר/],
  emailDevice: [/✉ מייל מהמכשיר/],
  emailGmail: [/שלח במייל \(Gmail\)/],
  // Today screen
  rosterImport: [/ייבא רשומה/],
  rosterCensus: [/רשימת מחלקה/],
  capture: [/^📷 צלם$/, /^צלם$/],
  addSoap: [/\+ SOAP/],
  // Roster modal
  rosterPasteTextarea: '#roster-paste',
  rosterPreview: [/תצוגה מקדימה/],
  rosterConfirm: [/^ייבא\s/, /^שמור/, /^אישור/, /^הוסף/],
  // Consult
  // Ortho
  copyOrthoSection: [/📋 העתק/],
};

// ============================================================================
// Recovery layer — soft-restart / hard-reload / kill
// ============================================================================

export class RecoveryGuard {
  constructor(page, persona, scenarioId, logBug) {
    this.page = page;
    this.persona = persona;
    this.scenarioId = scenarioId;
    this.logBug = logBug;
    this.lastActivity = Date.now();
    this.consecutiveFailures = 0;
    this.recoveryCount = 0;
  }
  beat() { this.lastActivity = Date.now(); this.consecutiveFailures = 0; }
  failed() { this.consecutiveFailures += 1; }
  /** Soft recovery: hash to '/' to escape stuck modal/route. */
  async softRecover() {
    this.recoveryCount += 1;
    try {
      await this.page.evaluate(() => { window.location.hash = '#/'; });
      await sleep(rand(800, 1500));
      this.beat();
      return true;
    } catch (_) {
      return false;
    }
  }
  /** Hard recovery: full page reload. */
  async hardRecover() {
    this.recoveryCount += 1;
    try {
      await this.page.reload({ timeout: 20_000 });
      await sleep(rand(1200, 2200));
      this.beat();
      return true;
    } catch (_) {
      return false;
    }
  }
  /** Did the page go silent? (no DOM mutations for `idleMs`). */
  isIdle(idleMs) {
    return Date.now() - this.lastActivity > idleMs;
  }
}

// ============================================================================
// Atomic actions — every action wraps try/catch + persona timing
// ============================================================================

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));

export async function personaSleep(persona) {
  await sleep(rand(persona.minDelay, persona.maxDelay));
}

/** Scroll into view + click + retry once on miss. Misclicker simulates miss. */
export async function safeClick(page, persona, locator, label, guard) {
  try {
    if (persona.missclickRate && Math.random() < persona.missclickRate) {
      // Simulate a miss — click 25-50px offset from the actual element.
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const ox = (Math.random() - 0.5) * 90;
        const oy = (Math.random() - 0.5) * 90;
        await page.mouse.click(box.x + box.width / 2 + ox, box.y + box.height / 2 + oy).catch(() => {});
        await sleep(rand(200, 600));
        // The recovery layer absorbs the miss — caller will retry on next tick.
        return { ok: false, missclick: true };
      }
    }
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await locator.click({ timeout: 4000 });
    if (guard) guard.beat();
    await personaSleep(persona);
    return { ok: true };
  } catch (err) {
    if (guard) guard.failed();
    return { ok: false, error: err.message?.slice(0, 100) };
  }
}

/**
 * V4.1 — wait for at least one of the given selectors to be present in the
 * DOM before reading. THE canonical pattern for any sub-bot doing
 * `page.evaluate(() => document.body.innerText)` immediately after a hash
 * navigation. Without this, sub-bots race the React mount and produce
 * 1.00-precision-but-bot-side-FP flags (the v4 lesson — see L1 in the bot
 * working notes).
 *
 * @param {Page} page
 * @param {Array<string|RegExp>} selectors — array of CSS selectors or text
 *   regexes. Returns as soon as ANY one matches (race-to-first).
 * @param {number} timeout — ms; defaults 5000.
 * @returns {Promise<{ok:boolean, matched?:string, waitMs:number}>}
 */
export async function waitForSubject(page, selectors, timeout = 5000) {
  // V4.2 — record-call into per-tick context. runPersona resets `page._v42WaitCount`
  // to 0 at the top of every action iteration; we increment here. The analyzer
  // (scripts/lib/v42Invariant.mjs) reads the resulting per-tick boolean to assert
  // every completed iteration of a v4 sub-bot was preceded by at least one wait.
  try { page._v42WaitCount = (page._v42WaitCount || 0) + 1; } catch (_) {}
  const t0 = Date.now();
  const promises = selectors.map((sel) => {
    if (sel instanceof RegExp) {
      // Text-pattern wait — poll body innerText for match.
      return new Promise((resolve, reject) => {
        const deadline = t0 + timeout;
        const tick = async () => {
          if (Date.now() > deadline) return reject(new Error(`text timeout: ${sel}`));
          const found = await page.evaluate((src) => {
            try { return new RegExp(src).test(document.body.innerText || ''); }
            catch (_) { return false; }
          }, sel.source).catch(() => false);
          if (found) return resolve({ ok: true, matched: String(sel), waitMs: Date.now() - t0 });
          setTimeout(tick, 100);
        };
        tick();
      });
    }
    // CSS selector wait via Playwright native.
    return page.waitForSelector(sel, { timeout, state: 'attached' })
      .then(() => ({ ok: true, matched: sel, waitMs: Date.now() - t0 }));
  });
  try {
    const result = await Promise.any(promises);
    return result;
  } catch (_err) {
    return { ok: false, waitMs: Date.now() - t0 };
  }
}

/** Find a button matching any pattern in the array; returns first found locator. */
export async function findByText(page, patterns) {
  for (const role of ['button', 'link', 'tab']) {
    for (const pat of patterns) {
      const loc = page.getByRole(role, { name: pat }).first();
      if ((await loc.count().catch(() => 0)) > 0) return loc;
    }
  }
  // Last resort: text-only.
  for (const pat of patterns) {
    const loc = page.getByText(pat).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

/** Type text with persona-tuned per-char delay. */
export async function safeFill(page, persona, locator, text, guard) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const charDelay = persona.typingSpeed === 'fast' ? 18 : persona.typingSpeed === 'slow' ? 90 : 45;
    await locator.click({ timeout: 3000 }).catch(() => {});
    // Use type() instead of fill() so per-char events fire (some apps debounce).
    await locator.type(text, { delay: charDelay });
    if (guard) guard.beat();
    return { ok: true };
  } catch (err) {
    if (guard) guard.failed();
    return { ok: false, error: err.message?.slice(0, 100) };
  }
}

// ============================================================================
// Chaos injectors — surface bugs random scripts can't reach
// ============================================================================

const CHAOS_HEBREW_TEXTS = [
  'בת 84 עם UTI עם דליריום + AKI prerenal — Ceftriaxone 1g IV q24h',
  'CHF NYHA III, פלא 40%, BNP 2400, Lasix 80mg IV bid',
  // Mix Hebrew + English + emoji + RLM:
  'מטופלת עם ‏‏Klebsiella pneumonia‏‏ ESBL+ → Meropenem 1g IV q8h 🩺',
  // Pure ASCII control chars + Hebrew:
  'דליריום‏‎ובלבול\t\nתחת\nציפלוקסצין',
  // Long runaway RTL → LTR boundary stress:
  'אבחנות:DM2 + HTN + CKD3 + AFib on Eliquis 5mg bid + Atorvastatin 40mg HS',
  // Edge case: emoji + numerical
  '⚠ דחיפות 🚨 BP 220/120 SpO2 78% RA',
];

export async function chaosTypeIntoVisibleInput(page, persona) {
  const inputs = page.locator('input[type="text"], textarea, [contenteditable="true"]');
  const n = await inputs.count().catch(() => 0);
  if (n === 0) return { skipped: 'no_inputs' };
  const idx = Math.floor(Math.random() * n);
  const target = inputs.nth(idx);
  const text = CHAOS_HEBREW_TEXTS[Math.floor(Math.random() * CHAOS_HEBREW_TEXTS.length)];
  return safeFill(page, persona, target, text);
}

export async function chaosBackButtonMash(page, persona) {
  // Mash browser back 3-5 times rapidly. Tests that the SPA recovers
  // and doesn't leak state into a phantom route.
  const reps = rand(3, 5);
  for (let i = 0; i < reps; i++) {
    await page.goBack({ timeout: 2000 }).catch(() => {});
    await sleep(rand(50, 150));
  }
  return { ok: true, reps };
}

export async function chaosClearStorage(page) {
  // Wipe IDB + sessionStorage mid-flow. Tests crash resistance.
  await page.evaluate(async () => {
    try {
      const dbs = (await indexedDB.databases?.()) || [];
      for (const d of dbs) {
        try { indexedDB.deleteDatabase(d.name); } catch (_) {}
      }
      sessionStorage.clear();
    } catch (_) {}
  }).catch(() => {});
  return { ok: true };
}

export async function chaosVisibilityCycle(page) {
  // Simulate the user backgrounding then foregrounding the app.
  // Many React apps react to visibilitychange to refresh state.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }).catch(() => {});
  await sleep(rand(800, 2000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  }).catch(() => {});
  return { ok: true };
}

export async function chaosKeyboardSpam(page) {
  // Press Tab + Enter + Esc + arrow keys randomly. Tests keyboard a11y
  // doesn't crash anything.
  const keys = ['Tab', 'Tab', 'Tab', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab', 'Shift+Tab'];
  for (let i = 0; i < rand(5, 10); i++) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    await page.keyboard.press(k).catch(() => {});
    await sleep(rand(40, 150));
  }
  return { ok: true };
}

export async function chaosRapidFireUploads(page, browser, scenario, reportDir) {
  // Fire 3 file uploads in 200ms. Tests session race-condition handling.
  const inputs = await page.locator(SEL.imageInput).all();
  if (inputs.length === 0) return { skipped: 'no_input' };
  const target = inputs[0];
  const buf = await generatePatientChart(scenario, browser);
  const tmp = path.resolve(reportDir, `_rapid_${scenario.scenario_id}_${Date.now()}.png`);
  await fs.writeFile(tmp, buf);
  for (let i = 0; i < 3; i++) {
    await target.setInputFiles(tmp, { timeout: 5000 }).catch(() => {});
    await sleep(rand(40, 120));
  }
  await fs.unlink(tmp).catch(() => {});
  return { ok: true };
}

// ============================================================================
// Scenarios — each is a high-level user-flow; persona picks weighted-random
// ============================================================================

export async function scenAdmissionEmit(page, browser, scenario, persona, guard, reportDir, logBug) {
  // Navigate → upload chart → drive Capture → Review → NoteEditor → copy.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await personaSleep(persona);

  // Maybe choppy, maybe clean — random.
  const choppy = Math.random() < 0.5;
  const cleanPng = await generatePatientChart(scenario, browser).catch(() => null);
  if (!cleanPng) return { error: 'gen_chart' };
  let buf = cleanPng;
  if (choppy) {
    try { buf = await distortImage(cleanPng, browser); } catch (_) { buf = cleanPng; }
  }
  const ext = choppy ? 'jpg' : 'png';
  const tmp = path.resolve(reportDir, `_adm_${scenario.scenario_id}_${Date.now()}.${ext}`);
  await fs.writeFile(tmp, buf);

  const inputs = await page.locator(SEL.imageInput).all();
  if (inputs.length === 0) {
    await fs.unlink(tmp).catch(() => {});
    return { skipped: 'no_input' };
  }
  await inputs[0].setInputFiles(tmp, { timeout: 8_000 }).catch(() => {});
  await fs.unlink(tmp).catch(() => {});
  await personaSleep(persona);

  // Click "המשך לבדיקה"
  const proceedBtn = await findByText(page, SEL.proceedToReview);
  if (proceedBtn) await safeClick(page, persona, proceedBtn, 'proceed-review', guard);

  // Wait up to 90s for review to be ready (extract finishes).
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const sig = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
      return {
        ready: btns.some((t) => /אישור ידני נדרש/.test(t) || /צור טיוטת רשימה/.test(t)),
        error: btns.some((t) => /חזרה לצילום/.test(t)) && document.body.innerText.includes('שגיאה'),
      };
    }).catch(() => ({ ready: false, error: false }));
    if (sig.ready) break;
    if (sig.error) {
      logBug('LOW', scenario.scenario_id, `${persona.name}/admission/extract-error`,
        'extract returned error state — graceful');
      return { ok: true, extractError: true };
    }
  }

  // Click all per-field confirm.
  const confirmBtns = page.getByRole('button', { name: /אישור ידני נדרש/ });
  const cN = await confirmBtns.count().catch(() => 0);
  for (let c = 0; c < cN; c++) {
    await safeClick(page, persona, confirmBtns.nth(c), 'confirm-field', guard);
  }

  // Generate note draft.
  const genBtn = await findByText(page, SEL.generateNoteList);
  if (genBtn) {
    const result = await safeClick(page, persona, genBtn, 'generate-note', guard);
    if (!result.ok) {
      logBug('LOW', scenario.scenario_id, `${persona.name}/admission/gen-blocked`,
        `forward button click failed: ${result.error || 'missclick'}`);
    }
  } else {
    logBug('LOW', scenario.scenario_id, `${persona.name}/admission/no-gen`,
      'no "צור טיוטת רשימה" button after confirms');
    return { ok: true, halted: 'no_gen' };
  }

  // Wait for /edit landing.
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const hash = await page.evaluate(() => location.hash).catch(() => '');
    if (hash.includes('/edit') || hash.includes('/save')) break;
  }

  // Copy + verify wrapForChameleon RLM/LRM markers.
  const copyBtn = await findByText(page, SEL.copyAll);
  if (copyBtn) {
    await safeClick(page, persona, copyBtn, 'copy-all', guard);
    await sleep(500);
    const clip = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (_) { return null; }
    }).catch(() => null);
    if (clip && clip.length > 0) {
      const hasRlm = clip.includes('‏');
      const hasLrm = clip.includes('‎');
      if (!hasRlm && !hasLrm) {
        logBug('HIGH', scenario.scenario_id, `${persona.name}/admission/no-bidi`,
          `clipboard ${clip.length} chars but no RLM/LRM — wrapForChameleon regression`);
      }
      const arrows = clip.match(/[→←↑↓]/g);
      if (arrows) {
        logBug('MEDIUM', scenario.scenario_id, `${persona.name}/admission/sanitizer-leak`,
          `${arrows.length} arrow chars survived — Chameleon-corrupting`);
      }
      const bold = /\*\*[^*]/.test(clip);
      if (bold) {
        logBug('MEDIUM', scenario.scenario_id, `${persona.name}/admission/sanitizer-leak`,
          `**bold** markdown survived sanitizer`);
      }
    }
  }

  return { ok: true };
}

export async function scenSoapRound(page, browser, scenario, persona, guard, reportDir, logBug) {
  await page.evaluate(() => { window.location.hash = '#/today'; });
  await personaSleep(persona);

  const importBtn = await findByText(page, SEL.rosterImport);
  if (importBtn) {
    await safeClick(page, persona, importBtn, 'roster-import', guard);
    await sleep(rand(500, 900));
    const ta = page.locator(SEL.rosterPasteTextarea).first();
    if ((await ta.count().catch(() => 0)) > 0) {
      const d = scenario.demographics || {};
      const lines = [
        `1 | ${d.name_he || 'מטופל'} | ${d.age || 80} | ${d.room || '12'} | ${d.bed || 'A'} | 5 | hip fx`,
        '2 | יעקב כהן | 75 | 15 | B | 3 | CHF',
        '3 | שרה לוי | 88 | 20 | A | 7 | UTI delirium',
      ];
      await safeFill(page, persona, ta, lines.join('\n'), guard);
      const previewBtn = await findByText(page, SEL.rosterPreview);
      if (previewBtn) {
        await safeClick(page, persona, previewBtn, 'preview', guard);
        await sleep(rand(800, 1200));
        const confirmBtn = await findByText(page, SEL.rosterConfirm);
        if (confirmBtn) await safeClick(page, persona, confirmBtn, 'roster-confirm', guard);
      }
    }
  }
  await sleep(rand(800, 1500));

  // Click + SOAP for first roster card.
  const soapBtns = page.getByRole('button', { name: /\+ SOAP/ });
  const sN = await soapBtns.count().catch(() => 0);
  if (sN > 0) {
    await safeClick(page, persona, soapBtns.first(), '+SOAP', guard);
    await sleep(rand(800, 1500));
    // Verify navigated to /capture (this is the user-reported bug — should
    // pre-fill identity, but currently re-prompts).
    const hash = await page.evaluate(() => location.hash).catch(() => '');
    if (hash.includes('/capture')) {
      // OK — verify rosterSeed is set in sessionStorage.
      const seed = await page.evaluate(() => sessionStorage.getItem('rosterSeed')).catch(() => null);
      if (!seed) {
        logBug('MEDIUM', scenario.scenario_id, `${persona.name}/soap/no-seed`,
          'sessionStorage.rosterSeed missing after +SOAP click — identity wiring broken');
      }
    }
  }
  return { ok: true };
}

export async function scenOrthoCalc(page, persona, guard, logBug, scenario) {
  // Tuned 2026-05-10: targeted clicks on named ortho buttons instead of
  // random index spam. Mega-bot v1 produced 567 LOW false-positives on
  // /ortho because random-index clicking compounds with misclicker's 20%
  // off-center rate. Now we click DVT prophylaxis copy + the first SOAP
  // template copy by aria-label, then verify clipboard markers.
  await page.evaluate(() => { window.location.hash = '#/ortho'; });
  await personaSleep(persona);

  // Click DVT prophylaxis copy button (aria-label="העתק פרופילקסיס DVT").
  const dvtBtn = page.locator('button[aria-label*="פרופילקסיס DVT"]').first();
  if ((await dvtBtn.count().catch(() => 0)) > 0) {
    const result = await safeClick(page, persona, dvtBtn, 'ortho-dvt-copy', guard);
    if (result.ok) {
      await sleep(300);
      const clip = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch (_) { return null; }
      }).catch(() => null);
      if (clip && clip.length > 0 && !clip.includes('‏') && !clip.includes('‎')) {
        logBug('HIGH', scenario.scenario_id, `${persona.name}/ortho/no-bidi`,
          `DVT copy missing RLM/LRM — Chameleon will corrupt. Got ${clip.length} chars: "${clip.slice(0, 60)}"`);
      }
    }
  }

  // Click first SOAP-template copy button (aria-label starts with "העתק תבנית").
  const tplBtns = page.locator('button[aria-label^="העתק תבנית"]');
  const tN = await tplBtns.count().catch(() => 0);
  if (tN > 0) {
    const idx = Math.floor(Math.random() * tN);
    const result = await safeClick(page, persona, tplBtns.nth(idx), `ortho-tpl-${idx}`, guard);
    if (result.ok) {
      await sleep(300);
      const clip = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch (_) { return null; }
      }).catch(() => null);
      if (clip && clip.length > 0 && !clip.includes('‏') && !clip.includes('‎')) {
        logBug('HIGH', scenario.scenario_id, `${persona.name}/ortho/template-no-bidi`,
          `template copy missing RLM/LRM markers`);
      }
    }
  }
  return { ok: true };
}

export async function scenConsult(page, persona, guard, logBug, scenario) {
  await page.evaluate(() => { window.location.hash = '#/consult'; });
  await personaSleep(persona);
  // Just probe — consult flow needs a target patient + body. For now,
  // fill any visible textarea + try to find a copy/send button.
  const ta = page.locator('textarea').first();
  if ((await ta.count().catch(() => 0)) > 0) {
    await safeFill(page, persona, ta, 'בקשה ליעוץ קרדיולוגי — בת 84 עם CHF דקומפנסציה. אנא בדיקה ויעוץ טיפולי. תודה.', guard);
  }
  // Spam-click everything visible.
  const btns = page.locator('button:visible');
  const N = await btns.count().catch(() => 0);
  if (N > 0) {
    await safeClick(page, persona, btns.first(), 'consult-btn-0', guard);
  }
  return { ok: true };
}

export async function scenHistory(page, persona, guard) {
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await personaSleep(persona);
  // Click first note in history if any.
  const links = page.locator('a[href*="#/note/"]');
  const N = await links.count().catch(() => 0);
  if (N > 0) {
    await safeClick(page, persona, links.first(), 'history-note', guard);
    await sleep(rand(800, 1500));
    // Try copy.
    const copyBtn = page.getByRole('button', { name: /העתק/ }).first();
    if ((await copyBtn.count().catch(() => 0)) > 0) {
      await safeClick(page, persona, copyBtn, 'note-copy', guard);
    }
  }
  return { ok: true };
}

export async function scenSettingsTour(page, persona, guard) {
  // V4 hardening per L5: replaced `interactives.nth(random)` with named
  // toggles. Random-index clicking compounds with misclicker's 20% miss
  // rate and produces zero signal on the settings surface (no error
  // states are reachable by random clicks here). Test the *real*
  // configurable surfaces by aria/text instead.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await personaSleep(persona);

  // Named toggles — use text/role lookup, NOT random index.
  const targets = [
    [/^שמור|^עדכן/, 'settings-save'],
    [/proxy|פרוקסי/i, 'settings-proxy-toggle'],
    [/exam|מבחן/i, 'settings-exam-toggle'],
    [/^כתובת/, 'settings-email-input'],
    [/^גיבוי|^שחזר/, 'settings-backup'],
    [/^שכחת סיסמה/, 'settings-forgot-password'],
  ];
  // Click up to 2 named targets per visit.
  const tried = new Set();
  for (let attempt = 0; attempt < 4 && tried.size < 2; attempt++) {
    const pick = targets[Math.floor(Math.random() * targets.length)];
    if (tried.has(pick[1])) continue;
    tried.add(pick[1]);
    const btn = await findByText(page, [pick[0]]);
    if (btn) {
      await safeClick(page, persona, btn, pick[1], guard);
      await sleep(rand(400, 900));
    }
  }
  return { ok: true, _botSubject: 'settings' };
}

// ============================================================================
// Action menu — weighted random sampler. Each persona picks one per tick.
// ============================================================================

export const ACTION_MENU = [
  // Core flows — uniform weights as before.
  { weight: 16, name: 'admission', fn: scenAdmissionEmit, botSubject: 'admission' },
  { weight: 12, name: 'soap',      fn: scenSoapRound,     botSubject: 'soap' },
  { weight: 8,  name: 'ortho',     fn: scenOrthoCalc,     botSubject: 'ortho' },
  { weight: 6,  name: 'consult',   fn: scenConsult,       botSubject: 'consult' },
  { weight: 6,  name: 'history',   fn: scenHistory,       botSubject: 'history' },
  { weight: 5,  name: 'settings',  fn: scenSettingsTour,  botSubject: 'settings' },
  // V4 sub-bots — lower weights since they're rarer flows. Min-coverage
  // scheduler ensures they fire at least N times per run regardless.
  { weight: 4,  name: 'emailToSelf',          fn: scenEmailToSelf,          botSubject: 'emailToSelf' },
  { weight: 4,  name: 'morningRoundsPrep',    fn: scenMorningRoundsPrep,    botSubject: 'morningRoundsPrep' },
  { weight: 3,  name: 'orthoCalcMath',        fn: scenOrthoCalcMath,        botSubject: 'orthoCalcMath' },
  { weight: 2,  name: 'resetPasswordLanding', fn: scenResetPasswordLanding, botSubject: 'resetPasswordLanding' },
];

export const CHAOS_MENU = [
  // v1-v3 chaos — kept as-is.
  { weight: 7, name: 'chaos-back-mash',      fn: (p, _b, _s, persona) => chaosBackButtonMash(p, persona) },
  { weight: 5, name: 'chaos-visibility',     fn: (p) => chaosVisibilityCycle(p) },
  { weight: 4, name: 'chaos-keyboard-spam',  fn: (p) => chaosKeyboardSpam(p) },
  { weight: 4, name: 'chaos-text-input',     fn: (p, _b, _s, persona) => chaosTypeIntoVisibleInput(p, persona) },
  { weight: 2, name: 'chaos-clear-storage',  fn: (p) => chaosClearStorage(p) },
  // V4 chaos — six new types. Lower weights for the slow ones (network
  // ramped takes 30s, midnight rollover holds 4s) so they fire less often.
  { weight: 3, name: 'chaos-network-ramped', fn: (p) => chaosNetworkRamped(p) },
  { weight: 2, name: 'chaos-idb-quota',      fn: (p) => chaosIdbQuotaStress(p) },
  { weight: 4, name: 'chaos-edge-swipe',     fn: (p) => chaosEdgeSwipeBack(p) },
  { weight: 2, name: 'chaos-midnight',       fn: (p) => chaosMidnightRollover(p) },
  { weight: 2, name: 'chaos-memory-pressure', fn: (p) => chaosMemoryPressure(p) },
  // chaosRandomClick has a different signature — needs scenarioId + logBug
  // so the random-click telemetry can carry the provenance tag. Wrapped at
  // the call site in runPersona.
  { weight: 5, name: 'chaos-random-click',   fn: '__needs_scenario_logBug__', _meta: 'random-click' },
];

export function pickWeighted(menu) {
  const total = menu.reduce((a, m) => a + m.weight, 0);
  let r = Math.random() * total;
  for (const m of menu) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return menu[menu.length - 1];
}

// ============================================================================
// Persona runner — long-running action loop with watchdog
// ============================================================================

export async function runPersona({
  browser,
  personaKey,
  scenario,
  durationMs,
  reportDir,
  url,
  logBug,
  onTick,
  scheduler,         // V4: shared MinCoverageScheduler (optional; null = no biasing)
  emailTarget,       // V4: bot-injected email setting so emailToSelf flow has a target
}) {
  const persona = PERSONAS[personaKey];
  if (!persona) throw new Error(`unknown persona: ${personaKey}`);

  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'he-IL',
  });
  await ctx.addInitScript((cfg) => {
    try { localStorage.setItem('batch_features', '1'); } catch (_) {}
    // V4: pre-set email target so emailToSelf flow has somewhere to send.
    if (cfg.emailTarget) {
      try { localStorage.setItem('ward-helper.emailTo', cfg.emailTarget); } catch (_) {}
    }
    // V4: pre-set lastArchivedDate to yesterday so MorningArchivePrompt fires.
    try {
      const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString('en-CA');
      localStorage.setItem('ward-helper.lastArchivedDate', yesterday);
    } catch (_) {}
  }, { emailTarget: emailTarget || 'bot+test@example.com' });
  const page = await ctx.newPage();
  attachDiagnostics(page, scenario.scenario_id, logBug);

  const guard = new RecoveryGuard(page, persona, scenario.scenario_id, logBug);
  const memory = new PersonaMemory();  // V4: per-persona click memory
  const tally = {
    actions: 0,
    chaos: 0,
    recoveries: 0,
    errors: 0,
    byAction: {},
    byBotSubject: {},  // V4: per-sub-bot fire counts
    usefulActions: 0,  // V4: actions that returned ok:true (not skipped, not error)
    longtaskCount: 0,  // V4: from diagnostics counts
  };

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await sleep(1200);

  let actionsThisCycle = 0;
  while (Date.now() - t0 < durationMs) {
    actionsThisCycle++;
    // Watchdog: 60s idle → soft recover, 180s → hard reload, 300s → bail
    if (guard.isIdle(300_000)) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/watchdog/dead`,
        '300s no activity — context dead, bailing persona');
      break;
    }
    if (guard.isIdle(180_000)) {
      tally.recoveries++;
      const ok = await guard.hardRecover();
      if (!ok) break;
      continue;
    }
    if (guard.isIdle(60_000)) {
      tally.recoveries++;
      await guard.softRecover();
      continue;
    }

    // V4: scheduler can force-pick under-fired sub-bots after 50% wall-time.
    // If scheduler returns a forced action, override the menu pick with it.
    const forced = scheduler ? scheduler.forcedPick() : null;
    let picked, isChaos;
    if (forced) {
      picked = ACTION_MENU.find((m) => m.name === forced);
      isChaos = false;
    } else {
      const chaosRate = persona.extraChaosRate ?? 0.3;
      isChaos = Math.random() < chaosRate;
      const menu = isChaos ? CHAOS_MENU : ACTION_MENU;
      picked = pickWeighted(menu);
    }

    // V4.2 — reset per-tick wait counter BEFORE the action runs, so this
    // iteration's count starts at 0. waitForSubject() increments
    // page._v42WaitCount each time it's called inside the action. The
    // post-action read (below, inside the try) records whether the helper
    // fired this tick; resetting after instead of before would let iteration
    // N inherit N-1's count and silently collapse the ratchet's discriminating
    // power. (Per-page scoping is automatic — `page` is created once per
    // runPersona via ctx.newPage() and never reassigned.)
    page._v42WaitCount = 0;

    try {
      // chaosRandomClick has a different signature — wrap at call site.
      let result;
      if (picked.fn === '__needs_scenario_logBug__') {
        result = await chaosRandomClick(page, persona, scenario.scenario_id, logBug);
      } else {
        result = await picked.fn(page, browser, scenario, persona, guard, reportDir, logBug);
      }
      // V4.2 — once we get here, the action returned without throwing.
      // iterationCompleted = "did not throw", NOT "result.ok === true". The
      // distinction matters: v4 sub-bots return {ok:false} after a logged-bug
      // path (e.g., wait timed out → logBug → return {ok:false}), and they DID
      // call waitForSubject first. The strict-completion reading would silently
      // miss the regression class "new sub-bot path productively runs without
      // calling wait and returns {ok:false}" — which is exactly what the
      // ratchet exists to catch.
      const iterationCompleted = true;
      const waitForSubjectCalled = (page._v42WaitCount || 0) > 0;

      tally.actions++;
      if (isChaos) tally.chaos++;
      tally.byAction[picked.name] = (tally.byAction[picked.name] || 0) + 1;
      // V4: track per-sub-bot fire count + register with scheduler.
      const subj = picked.botSubject || result?._botSubject || picked.name;
      tally.byBotSubject[subj] = (tally.byBotSubject[subj] || 0) + 1;
      if (scheduler && !isChaos) scheduler.recordFire(picked.name);
      // V4: usefulActions = ok-returning core actions (not chaos, not skips, not errors).
      const isUseful = !isChaos && result?.ok === true;
      if (isUseful) tally.usefulActions++;
      if (result?.error) tally.errors++;
      if (onTick) onTick({
        persona: persona.name, action: picked.name, botSubject: subj,
        isChaos, isUseful, elapsed: Date.now() - t0, result,
        // V4.2 telemetry — analyzer (v42Invariant.mjs) gates on these.
        waitForSubjectCalled, iterationCompleted,
      });
    } catch (err) {
      tally.errors++;
      logBug('LOW', scenario.scenario_id, `${persona.name}/${picked.name}/exception`,
        `harness exception: ${err.message?.slice(0, 100)}`);
      // Soft-recover after exception so next iteration starts clean.
      await guard.softRecover().catch(() => {});
    }

    // Battery saver persona: every 8 actions, simulate phone sleep.
    if (persona.sleepCycleEvery && actionsThisCycle % persona.sleepCycleEvery === 0) {
      await chaosVisibilityCycle(page);
      tally.chaos++;
    }
  }

  const wallMs = Date.now() - t0;
  // V4: pull longtask count from the diag closure if exposed via window.
  const memSummary = memory.summary();
  await ctx.close().catch(() => {});
  return {
    persona: persona.name,
    personaKey,
    wallMs,
    tally,
    recoveries: guard.recoveryCount,
    memorySummary: memSummary,
  };
}
