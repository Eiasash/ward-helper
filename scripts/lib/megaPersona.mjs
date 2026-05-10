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
  await page.evaluate(() => { window.location.hash = '#/ortho'; });
  await personaSleep(persona);
  // Click any button on the ortho page — POD/suture/DVT calcs all expose copy buttons.
  const allBtns = page.locator('button');
  const N = await allBtns.count().catch(() => 0);
  if (N === 0) {
    logBug('LOW', scenario.scenario_id, `${persona.name}/ortho/no-buttons`, '/ortho has no buttons');
    return { ok: false };
  }
  // Click 3 random buttons on /ortho — exercises calcs + accordions.
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * N);
    await safeClick(page, persona, allBtns.nth(idx), `ortho-btn-${idx}`, guard);
  }
  // Try copy.
  const copyBtn = await findByText(page, SEL.copyOrthoSection);
  if (copyBtn) {
    await safeClick(page, persona, copyBtn, 'ortho-copy', guard);
    await sleep(400);
    const clip = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (_) { return null; }
    }).catch(() => null);
    if (clip && clip.length > 0 && !clip.includes('‏') && !clip.includes('‎')) {
      logBug('HIGH', scenario.scenario_id, `${persona.name}/ortho/no-bidi`,
        'ortho copy missing RLM/LRM markers — Chameleon paste will corrupt');
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
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await personaSleep(persona);
  // Click first 3 visible buttons or details/summary toggles to exercise
  // settings sub-sections.
  const interactives = page.locator('button:visible, summary:visible');
  const N = await interactives.count().catch(() => 0);
  for (let i = 0; i < Math.min(3, N); i++) {
    const idx = Math.floor(Math.random() * N);
    await safeClick(page, persona, interactives.nth(idx), `settings-${idx}`, guard);
  }
  return { ok: true };
}

// ============================================================================
// Action menu — weighted random sampler. Each persona picks one per tick.
// ============================================================================

export const ACTION_MENU = [
  { weight: 18, name: 'admission', fn: scenAdmissionEmit },
  { weight: 14, name: 'soap',      fn: scenSoapRound },
  { weight: 8,  name: 'ortho',     fn: scenOrthoCalc },
  { weight: 6,  name: 'consult',   fn: scenConsult },
  { weight: 6,  name: 'history',   fn: scenHistory },
  { weight: 5,  name: 'settings',  fn: scenSettingsTour },
];

export const CHAOS_MENU = [
  { weight: 8, name: 'chaos-back-mash',      fn: (p, _b, _s, persona) => chaosBackButtonMash(p, persona) },
  { weight: 6, name: 'chaos-visibility',     fn: (p) => chaosVisibilityCycle(p) },
  { weight: 5, name: 'chaos-keyboard-spam',  fn: (p) => chaosKeyboardSpam(p) },
  { weight: 5, name: 'chaos-text-input',     fn: (p, _b, _s, persona) => chaosTypeIntoVisibleInput(p, persona) },
  { weight: 3, name: 'chaos-clear-storage',  fn: (p) => chaosClearStorage(p) },
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
}) {
  const persona = PERSONAS[personaKey];
  if (!persona) throw new Error(`unknown persona: ${personaKey}`);

  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'he-IL',
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('batch_features', '1'); } catch (_) {}
  });
  const page = await ctx.newPage();
  attachDiagnostics(page, scenario.scenario_id, logBug);

  const guard = new RecoveryGuard(page, persona, scenario.scenario_id, logBug);
  const tally = { actions: 0, chaos: 0, recoveries: 0, errors: 0, byAction: {} };

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

    // Pick action: 70% scenario, 30% chaos (or persona's extraChaosRate).
    const chaosRate = persona.extraChaosRate ?? 0.3;
    const isChaos = Math.random() < chaosRate;
    const menu = isChaos ? CHAOS_MENU : ACTION_MENU;
    const picked = pickWeighted(menu);

    try {
      const result = await picked.fn(page, browser, scenario, persona, guard, reportDir, logBug);
      tally.actions++;
      if (isChaos) tally.chaos++;
      tally.byAction[picked.name] = (tally.byAction[picked.name] || 0) + 1;
      if (result?.error) tally.errors++;
      if (onTick) onTick({ persona: persona.name, action: picked.name, elapsed: Date.now() - t0, result });
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
  await ctx.close().catch(() => {});
  return { persona: persona.name, wallMs, tally, recoveries: guard.recoveryCount };
}
