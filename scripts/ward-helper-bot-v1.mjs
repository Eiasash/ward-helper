#!/usr/bin/env node
/**
 * ward-helper-bot-v1 — synthetic-patient + upload-stress + admission-emit harness.
 *
 * v2 additions (2026-05-10):
 *   - iPhone 13 device emulation (was 380×800 desktop viewport).
 *   - clipboard-read/write permissions on context for wrapForChameleon verify.
 *   - 4 diagnostic hooks (CSP / unhandledrejection / page.crash / slow-ack).
 *   - runAdmissionEmit       — full /capture → /review → /edit → 📋 העתק → clipboard RLM/LRM check.
 *   - runSoapDailyRound      — /today + roster paste + per-patient card click.
 *   - runChoppyAzmaUpload    — distorted JPEG (rotate 0-15°, q=0.35-0.6) tests compress.ts path.
 *   - runDischargeNote       — discharge-type variant of admission-emit.
 *   - WARD_BOT_FIXTURE=1     — skip Opus, use hardcoded synthetic scenario (free harness validation).
 *   - WARD_BOT_LEGACY=1      — also run v1's older sub-bots (50MB / minimal-PDF / 1×1-PNG / census / roster).
 *   - cost-cap default: $60 → $20 (smoke first, expand consciously).
 *   - bug report grouped by flow + severity matrix.
 *
 * v1 baseline (2026-05-08):
 *   - Scenario generator (Opus 4.7 + adaptive thinking) — real call.
 *   - Persistence to local jsonl (Supabase RLS denies anon writes by design).
 *   - Adversarial 50MB upload, minimal PDF, 1×1 PNG, synthetic census, roster paste.
 *
 * To run (smoke, harness validation, free):
 *   WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed WARD_BOT_FIXTURE=1 \
 *     node scripts/ward-helper-bot-v1.mjs
 *
 * To run (real Opus scenarios — needs CLAUDE_API_KEY):
 *   WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed CLAUDE_API_KEY=$key \
 *     WARD_BOT_SCENARIOS=1 node scripts/ward-helper-bot-v1.mjs
 *
 * Cost-cap: $20 default. Single scenario ≈ $1.50 (Opus 4.7 + thinking).
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { attachDiagnostics } from './lib/diagnostics.mjs';
import { generatePatientChart, generateLabReportPng } from './lib/azmaImage.mjs';
import { distortImage } from './lib/distortImage.mjs';
// 2026-05-12: shared bidi-mark constants (single SoT — keeps detector in
// lockstep with the app-side wrapForChameleon). See src/i18n/bidiMarks.mjs
// header for rationale.
import { BIDI_MARKS_RE } from '../src/i18n/bidiMarks.mjs';

// iPhone 13: viewport 390x844, isMobile, hasTouch, deviceScaleFactor 3.
// Real ward usage is mobile-first; the v1 380x800 desktop viewport missed
// touch + scroll-then-tap timing bugs and the PWA standalone mode.
const MOBILE_DEVICE = devices['iPhone 13'];

// ============================================================================
// LAUNCH-LATER GATE — must be set explicitly to authorize a run.
// ============================================================================

if (process.env.WARD_BOT_RUN_AUTHORIZED !== 'yes-i-reviewed') {
  console.error('═══════════════════════════════════════════════════════════════');
  console.error(' ward-helper-bot-v1: REFUSING TO RUN.');
  console.error('');
  console.error(' Set WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed to authorize.');
  console.error(' MVP does 1 scenario by default. Promote scenarios after first pass.');
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(2);
}

// ============================================================================
// Config + secrets
// ============================================================================

const KEY = process.env.CLAUDE_API_KEY;
const FIXTURE_MODE = process.env.WARD_BOT_FIXTURE === '1';
if (!FIXTURE_MODE) {
  if (!KEY) { console.error('CLAUDE_API_KEY not set (or pass WARD_BOT_FIXTURE=1 to skip Opus)'); process.exit(2); }
  if (KEY.length !== 108) {
    console.error(`CLAUDE_API_KEY length=${KEY.length}, expected 108 — fix env, retry.`);
    process.exit(2);
  }
}

const SUPA_URL = process.env.SUPABASE_URL || 'https://krmlzwwelqvlfslwltol.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON || 'sb_publishable_tUuqQQ8RKMvLDwTz5cKkOg_o_y-rHtw';

const CONFIG = {
  url: process.env.WARD_BOT_URL || 'https://eiasash.github.io/ward-helper/',
  scenarios: Math.max(1, Number(process.env.WARD_BOT_SCENARIOS || 1)),
  // Default $20 (was $60) — first promotion is N=1 smoke; expand consciously.
  costCapUsd: Number(process.env.CHAOS_COST_CAP_USD || 20),
  model: process.env.CHAOS_MODEL || 'claude-opus-4-7',
  thinkingBudget: Number(process.env.CHAOS_THINKING_BUDGET || 16000),
  reportDir: process.env.CHAOS_REPORT_DIR || 'chaos-reports/ward-bot-v1',
  headless: process.env.CHAOS_HEADLESS !== '0',
  navigationTimeoutMs: Number(process.env.WARD_BOT_NAV_TIMEOUT_MS || 30_000),
  actionTimeoutMs: Number(process.env.WARD_BOT_ACTION_TIMEOUT_MS || 5_000),
  // WARD_BOT_FIXTURE=1 → use fixture scenario instead of Opus generation.
  // Lets the harness be validated without burning credits.
  useFixture: process.env.WARD_BOT_FIXTURE === '1',
  // WARD_BOT_LEGACY=1 → also run v1's older sub-bots
  // (50MB upload, minimal PDF, 1×1 PNG, census, roster). Off by default
  // so v2 smokes are fast.
  runLegacy: process.env.WARD_BOT_LEGACY === '1',
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const COST = { calls: 0, inTok: 0, outTok: 0 };

// Opus 4.7 pricing per million tokens (2026-05).
const COST_RATE = { in: 15.0 / 1_000_000, out: 75.0 / 1_000_000 };
function totalUsd() { return COST.inTok * COST_RATE.in + COST.outTok * COST_RATE.out; }

const SCENARIOS_SEEDS = [
  'hip fracture s/p ORIF, post-op delirium, geriatric',
  'decompensated CHF NYHA III, acute on chronic kidney disease',
  'urinary tract infection with delirium in 88yo, polypharmacy',
  'post-stroke rehab, dysphagia, aspiration risk',
  'end-stage pancreatic cancer, palliative admission for pain',
];

const SUPA = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
const RUN_ID = `wb-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const REPORT_PATH = path.resolve(CONFIG.reportDir, `${RUN_ID}.md`);
const SCENARIO_LOG_PATH = path.resolve(CONFIG.reportDir, `${RUN_ID}-scenarios.jsonl`);

const BUGS = []; // { severity, scenario_id, where, what, evidence? }

// ============================================================================
// Helpers
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
const nowIso = () => new Date().toISOString();

function logBug(severity, scenario_id, where, what, evidence) {
  const bug = { severity, scenario_id, where, what, evidence, at: nowIso() };
  BUGS.push(bug);
  console.warn(`[BUG/${severity}] ${where}: ${what}`);
}

async function callOpus({ system, user, maxTokens = 32000 }) {
  if (totalUsd() >= CONFIG.costCapUsd) {
    console.error(`[cost-cap] $${totalUsd().toFixed(2)} >= $${CONFIG.costCapUsd} — aborting`);
    process.exit(3);
  }
  const body = {
    model: CONFIG.model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: process.env.CHAOS_EFFORT || 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  COST.calls += 1;
  COST.inTok += data.usage?.input_tokens || 0;
  COST.outTok += data.usage?.output_tokens || 0;
  // Extract text content (skip thinking blocks).
  const textBlocks = (data.content || []).filter((b) => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('\n');
  return { text, usage: data.usage };
}

function extractJsonBlock(text) {
  // Strip markdown fences then balance braces.
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
  let depth = 0; let start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) {
      try { return JSON.parse(stripped.slice(start, i + 1)); } catch (_) { /* fall through */ }
    }}
  }
  throw new Error(`No JSON object found in: ${text.slice(0, 200)}...`);
}

// ============================================================================
// Scenario generator
// ============================================================================

const SCENARIO_SYSTEM = `You are a board-grade Israeli geriatric medicine attending generating SYNTHETIC patient scenarios for a chart-software stress-test bot.

CRITICAL constraints:
- All identifiers are FICTITIOUS. Hebrew first name + Hebrew last name from the synthetic name pool. NEVER use a real public-figure name.
- Israeli ID (teudat zehut) MUST be a 9-digit string with INTENTIONALLY INVALID checksum. The Israeli MOH algorithm validates: weights [1,2,1,2,1,2,1,2,1], sum digits if >9, total sum mod 10 must equal 0. Make sure your tz fails this.
- Demographics realistic: age 70-95, sex F/M, room number 1-50, bed letter A/B.
- Clinical course must be plausible — no contradictory diagnoses, no impossible vitals.
- Hebrew clinical text must use proper Israeli medical Hebrew with embedded English drug names + lab abbreviations (do NOT transliterate).
- Day-1 admission note + day-2..N daily SOAP rounds + 1-2 consult letters + 1 discharge letter.

Output ONLY valid JSON matching the shape requested. No prose outside the JSON block.`;

async function generateScenario(seedIdx) {
  const seed = SCENARIOS_SEEDS[seedIdx % SCENARIOS_SEEDS.length];
  // 3-4 day cap (was 3-7). Longer scenarios occasionally truncate at 64k
  // even with effort=medium — Opus produces verbose Hebrew SOAP rounds.
  // 3-4 days is enough to test upload flows; the bot doesn't validate
  // clinical longitudinal-care logic.
  const dayCount = rand(3, 4);
  const userPrompt = `Generate ONE synthetic scenario for: "${seed}" with ${dayCount} day SOAP rounds.

Return JSON exactly matching this shape:
{
  "scenario_id": "syn-2026-05-08-XXX",
  "demographics": {
    "name_he": "string (Hebrew, fictitious)",
    "tz": "9 digits, INVALID checksum",
    "age": int,
    "sex": "M" | "F",
    "room": "1-50",
    "bed": "A" | "B"
  },
  "chief_complaint": "Hebrew, 1-2 sentences",
  "admission_note": { "S": "Hebrew", "O": "Hebrew with English drug names", "A": "Hebrew", "P": "Hebrew with English meds" },
  "soap_rounds": [{ "day": int, "S": "...", "O": "...", "A": "...", "P": "..." }, ...],
  "consult_letters": [{ "from": "Geriatrics", "to": "Cardiology" | "Nephrology" | etc, "body": "Hebrew" }],
  "discharge_letter": { "summary": "Hebrew", "meds_at_discharge": "...", "follow_up": "..." }
}

The scenario MUST be ready to copy-paste into a real clinical workflow. Any obvious AI-isms (e.g. "this is a synthetic patient") should NOT appear in the clinical text fields. The clinical text should read as if a tired geriatrics fellow at 03:00 typed it.`;

  console.log(`  → generating scenario ${seedIdx + 1}/${CONFIG.scenarios}: "${seed}" (${dayCount}d)`);
  // 96k output cap. v5 truncated at 32k, v10 truncated at 64k on 5-day
  // scenarios with effort=medium. Opus 4.7 thinking can consume 20-30k
  // tokens leaving variable output budget. 96k is generous; thinking-mode
  // tokens billed at output rate so cost-per-call ≈ $1.50-2.00 max.
  const { text } = await callOpus({ system: SCENARIO_SYSTEM, user: userPrompt, maxTokens: 96000 });
  let scenario;
  try {
    scenario = extractJsonBlock(text);
  } catch (err) {
    // Fallback: attempt to repair a truncated JSON by slicing from the first
    // '{' and trimming back to the last balanced position.
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      let lastOk = -1;
      for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) lastOk = i; }
      }
      if (lastOk > 0) {
        try { scenario = JSON.parse(text.slice(firstBrace, lastOk + 1)); }
        catch (_) { /* still bad */ }
      }
    }
    if (!scenario) {
      logBug('HIGH', `seed-${seedIdx}`, 'scenario-generate', `JSON extract failed: ${err.message.slice(0, 80)}`, text.slice(text.length - 200));
      throw err;
    }
  }

  // Validate.
  if (!scenario.demographics?.tz || !/^\d{9}$/.test(scenario.demographics.tz)) {
    logBug('HIGH', scenario.scenario_id || `seed-${seedIdx}`, 'scenario-validate', 'tz not 9 digits', scenario.demographics?.tz);
  } else {
    // Verify checksum is intentionally invalid.
    const digits = scenario.demographics.tz.split('').map(Number);
    const weights = [1, 2, 1, 2, 1, 2, 1, 2, 1];
    const sum = digits.reduce((a, d, i) => {
      const p = d * weights[i];
      return a + (p > 9 ? p - 9 : p);
    }, 0);
    if (sum % 10 === 0) {
      logBug('MEDIUM', scenario.scenario_id, 'scenario-validate', 'tz checksum is VALID — generator violated invalid-tz rule', scenario.demographics.tz);
    }
  }
  if (!scenario.scenario_id) scenario.scenario_id = `syn-${RUN_ID}-${seedIdx}`;
  scenario._seed = seed;
  scenario._dayCount = dayCount;
  return scenario;
}

// ============================================================================
// Persistence
// ============================================================================

async function persistScenario(scenario) {
  const row = {
    scenario_id: scenario.scenario_id,
    demographics: scenario.demographics,
    chief_complaint: scenario.chief_complaint,
    admission_note: scenario.admission_note,
    discharge_letter: scenario.discharge_letter,
    consult_letters: scenario.consult_letters,
    soap_rounds: scenario.soap_rounds,
    uploaded_files: {},
    bugs_found: [],
    generation_model: CONFIG.model,
    is_synthetic: true,
  };
  // RLS denies all anon access by design — go via REST PostgREST direct using the publishable key
  // and hope SECURITY DEFINER isn't needed... actually the policy is "FOR ALL USING (false)"
  // which blocks even reads. INSERTs through PostgREST are blocked by the same policy.
  // Solution: use a SECURITY DEFINER RPC OR write to a local jsonl file as the durable record.
  // For MVP, write to local jsonl as durable record + skip Supabase.
  await fs.appendFile(SCENARIO_LOG_PATH, JSON.stringify(row) + '\n', 'utf8');
  console.log(`  ✓ scenario persisted to ${SCENARIO_LOG_PATH}`);
  return row;
}

// ============================================================================
// Playwright flow — register synthetic user + draft note
// ============================================================================

/**
 * Switch to the register form. ward-helper's AccountSection toggles between
 * login and register inline — login form has placeholder "שם משתמש" (no
 * length suffix), register has "שם משתמש (3-32 תווים, אנגלית קטנה+מספרים)".
 * Click the toggle button labeled "אין לי חשבון" / "הרשמה" / "register" to
 * reveal the register form.
 */
async function switchToRegisterForm(page) {
  // First check if register form is already visible (no toggle needed).
  const regAlready = page.getByPlaceholder(/שם משתמש \(3-32 תווים/);
  if ((await regAlready.count().catch(() => 0)) > 0) return true;

  // ward-helper AccountSection (tsx:733+) uses role="tab" on the login/register
  // tabs, NOT role="button". Try tab role first, then fall back to button.
  const togglePatterns = [
    /^הרשמה$/,                          // bare "Registration" — primary
    /אין לי חשבון/,
    /צור חשבון/,
    /הרשמה חדשה/,
    /^register$/i,
  ];
  for (const role of ['tab', 'button']) {
    for (const pat of togglePatterns) {
      const tab = page.getByRole(role, { name: pat }).first();
      if ((await tab.count().catch(() => 0)) > 0) {
        await tab.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
        await sleep(rand(400, 800));
        const regField = page.getByPlaceholder(/שם משתמש \(3-32 תווים/);
        if ((await regField.count().catch(() => 0)) > 0) return true;
      }
    }
  }
  // Last resort: navigate to /account hash and retry once.
  await page.evaluate(() => { window.location.hash = '#/account'; }).catch(() => {});
  await sleep(800);
  for (const role of ['tab', 'button']) {
    const tab = page.getByRole(role, { name: /^הרשמה$/ }).first();
    if ((await tab.count().catch(() => 0)) > 0) {
      await tab.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      await sleep(600);
      const regField = page.getByPlaceholder(/שם משתמש \(3-32 תווים/);
      if ((await regField.count().catch(() => 0)) > 0) return true;
    }
  }
  return false;
}

/** Programmatic register flow. Returns { ok, error } */
async function registerSyntheticUser(page, scenarioId, synthUser, synthPass) {
  const switched = await switchToRegisterForm(page);
  if (!switched) {
    // Maybe the page already shows register by default. Check.
    const regField = page.getByPlaceholder(/שם משתמש \(3-32 תווים/);
    if ((await regField.count().catch(() => 0)) === 0) {
      logBug('HIGH', scenarioId, 'register-form', 'could not switch to register tab — no toggle button matched any known pattern');
      return { ok: false, error: 'no_register_tab' };
    }
  }

  const userField = page.getByPlaceholder(/שם משתמש \(3-32 תווים/);
  const passField = page.getByPlaceholder(/סיסמה \(לפחות 6 תווים\)/);
  await userField.fill(synthUser);
  await sleep(rand(150, 400));
  await passField.fill(synthPass);
  await sleep(rand(300, 600));

  const submitBtn = page.getByRole('button', { name: /הרשמה|הירשם|submit|create/i }).first();
  if ((await submitBtn.count().catch(() => 0)) === 0) {
    logBug('HIGH', scenarioId, 'register-form', 'no submit button found');
    return { ok: false, error: 'no_submit' };
  }
  await submitBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
  await sleep(rand(1500, 2500));

  // Check for error banner.
  const errBanner = page.getByText(/שגיאה|error/i).first();
  if ((await errBanner.count().catch(() => 0)) > 0) {
    const errText = await errBanner.textContent().catch(() => 'unknown');
    logBug('HIGH', scenarioId, 'register-flow', `register returned error: ${errText}`);
    return { ok: false, error: errText };
  }
  return { ok: true };
}

/** Programmatic login flow (assumes register form is NOT shown). */
async function loginUser(page, username, password) {
  const userField = page.getByPlaceholder(/^שם משתמש$/).first();
  if ((await userField.count().catch(() => 0)) === 0) return { ok: false, error: 'no_login_form' };
  const passField = page.getByPlaceholder(/^סיסמה$/).first();
  await userField.fill(username);
  await sleep(rand(150, 350));
  await passField.fill(password);
  await sleep(rand(150, 350));
  const submitBtn = page.getByRole('button', { name: /^התחבר$|^login$|^sign in$/i }).first();
  if ((await submitBtn.count().catch(() => 0)) === 0) return { ok: false, error: 'no_login_submit' };
  await submitBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
  await sleep(rand(1500, 2500));
  return { ok: true };
}

/** Navigate to the Capture screen post-auth. ward-helper SPA uses hash routing. */
async function navigateToCapture(page) {
  await page.evaluate(() => { window.location.hash = '#/'; });
  await sleep(rand(400, 700));
  // The default route should be Capture for an authenticated user.
  // Verify: file inputs of the Capture component are now in DOM.
  const fileInputs = await page.locator('input[type="file"]').all();
  return fileInputs.length > 0;
}

async function newMobileContext(browser) {
  // iPhone 13 device descriptor + clipboard permissions for Chameleon-copy
  // verification. permissions are granted on the production origin only.
  const ctx = await browser.newContext({
    ...MOBILE_DEVICE,
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'he-IL',
  });
  // Seed the SOAP-mode UI feature flag (`batch_features=1` in localStorage).
  // Without this, /today doesn't render "ייבא רשומה" / patient-list import.
  // See src/notes/soapMode.ts::isSoapModeUiEnabled. addInitScript runs
  // before the SPA mounts so React reads the flag on first paint.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('batch_features', '1'); } catch (_) {}
  });
  return ctx;
}

async function runPlaywrightFlow(scenario, browser) {
  const ctx = await newMobileContext(browser);
  const page = await ctx.newPage();
  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ at: nowIso(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    logBug('CRITICAL', scenario.scenario_id, 'playwright-pageerror', err.message, err.stack?.slice(0, 500));
  });
  page.on('requestfailed', (req) => {
    networkErrors.push({ at: nowIso(), url: req.url(), failure: req.failure()?.errorText });
  });

  try {
    await page.goto(CONFIG.url, { timeout: CONFIG.navigationTimeoutMs, waitUntil: 'domcontentloaded' });
    await sleep(rand(800, 1500));

    // ward-helper is local-first — no auth gate on landing. Just verify the
    // app loaded by checking for the Capture screen's file inputs.
    const fileInputs = await page.locator('input[type="file"]').count().catch(() => 0);
    if (fileInputs === 0) {
      logBug('MEDIUM', scenario.scenario_id, 'journey-load', 'no file inputs on landing — Capture may not be the default route');
    }

    // Settings → AccountSection → register flow could be tested here, but
    // the cloud-sync register flow is separate concern from chart UX.
    await ctx.close();
    return { consoleErrors, networkErrors, success: true };
  } catch (err) {
    logBug('CRITICAL', scenario.scenario_id, 'playwright-flow', err.message, err.stack?.slice(0, 500));
    await ctx.close().catch(() => {});
    return { consoleErrors, networkErrors, success: false, error: err.message };
  }
}

// ============================================================================
// Adversarial 50MB upload — separate browser session
// ============================================================================

/**
 * Browser context on the Capture screen. ward-helper is local-first — no
 * auth gate on landing — so we just navigate and rely on file inputs being
 * present in DOM (Capture is the default route).
 *
 * (The Phase 7 v2 attempt to register first was wrong: AccountSection lives
 * in Settings, not on landing. Reverting to v1's direct-navigate strategy.)
 */
async function captureContext(scenario, browser) {
  const ctx = await newMobileContext(browser);
  const page = await ctx.newPage();
  let crashed = false;
  page.on('pageerror', (err) => {
    crashed = true;
    logBug('CRITICAL', scenario.scenario_id, 'capture-context-pageerror', err.message);
  });
  // Wire the 4 new diagnostic hooks (csp / unhandledrejection / crash /
  // console.warning / slow-ack) onto every page that we drive. Cheap hooks,
  // no Anthropic cost; catches a class of failures vitest can't see.
  const diag = attachDiagnostics(page, scenario.scenario_id, logBug);
  await page.goto(CONFIG.url, { timeout: CONFIG.navigationTimeoutMs, waitUntil: 'domcontentloaded' });
  await sleep(800);

  const fileInputs = await page.locator('input[type="file"]').all();
  if (fileInputs.length === 0) {
    logBug('MEDIUM', scenario.scenario_id, 'capture-context', 'no file inputs on landing — UI may have shifted');
  }
  return { ok: true, ctx, page, crashed: () => crashed, diag };
}

// Legacy auth-context kept for the Settings-flow tests (later sub-bots may
// need it for cloud sync features). Not used by current sub-bots.
const authedCaptureContext = captureContext;

/**
 * Wait up to `maxMs` for a banner matching one of several selectors. ward-helper
 * Capture.tsx renders setPickWarn into an element with class `pick-warn` (or
 * a sibling status class). React state updates may be batched and the banner
 * may appear 100ms+ after setInputFiles fires — a flat 2s sleep can miss it
 * on fast machines (the file-filter early-returns + setPickWarn is sync but
 * the React re-render is async).
 */
async function waitForWarningBanner(page, maxMs = 4000) {
  // Capture.tsx renders setPickWarn into <div className="pill pill-warn">.
  // The fix-shipped Hebrew text is "X תמונות גדולות מדי (מקס׳ 10MB)" —
  // "גדולות" (fem.pl.) NOT "גדול" (masc.sg.) so the regex needs to handle
  // gender forms. Also: pickWarn auto-clears after 4s (PICK_WARN_TTL_MS).
  const selectors = [
    '.pill-warn',                  // exact ward-helper class
    '.pick-warn',                  // legacy/sibling
    '[class*="pill-warn"]',
    '[class*="warn"]',
    '[role="alert"]',
    '[role="status"]',
  ];
  // Hebrew gender forms: גדול (m.sg), גדולה (f.sg), גדולים (m.pl), גדולות (f.pl)
  const textPatterns = [
    /גדול\S* מדי/,                  // any "big-form too" — sg/pl/m/f
    /תקרה/,                         // "ceiling/limit" — banner message
    /מקס[׳']?\s*\d+\s*MB/i,         // "max NMB" suffix
    /שגיאה/,                        // generic error
    /too\s+large/i,
    /error/i,
  ];
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        const text = (await loc.textContent().catch(() => '')) || '';
        if (text.trim().length > 0) {
          for (const re of textPatterns) {
            if (re.test(text)) return { found: true, via: sel, text: text.slice(0, 120) };
          }
        }
      }
    }
    // Fall back to text-only search across the whole page.
    for (const re of textPatterns) {
      const loc = page.getByText(re).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        const text = (await loc.textContent().catch(() => '')) || '';
        return { found: true, via: 'text', text: text.slice(0, 120) };
      }
    }
    await sleep(150);  // poll faster — banner has 4s TTL
  }
  return { found: false };
}

async function runAdversarialUpload(scenario, browser) {
  const session = await authedCaptureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page } = session;
  try {
    const fileInputs = await page.locator('input[type="file"]').all();
    if (fileInputs.length === 0) {
      logBug('LOW', scenario.scenario_id, 'adversarial-upload', 'no file inputs in DOM after login + navigateToCapture');
      await ctx.close();
      return { skipped: 'no_file_inputs' };
    }

    const big = Buffer.alloc(50 * 1024 * 1024, 0x42); // 50MB of 'B'
    const tmpPath = path.resolve(CONFIG.reportDir, `_adv_50mb_${scenario.scenario_id}.bin`);
    await fs.writeFile(tmpPath, big);

    // Use the first IMAGE-accepting input (skip PDF inputs that have their own guard).
    let imageInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { imageInput = inp; break; }
    }
    if (!imageInput) imageInput = fileInputs[0];

    const t0 = Date.now();
    let raised = false;
    try {
      await imageInput.setInputFiles(tmpPath, { timeout: 30_000 });
    } catch (err) {
      raised = true;
      console.log(`  adversarial: setInputFiles raised: ${err.message.slice(0, 100)}`);
    }
    const dt = Date.now() - t0;

    // Improved banner detection: poll up to 4s (matches PICK_WARN_TTL_MS)
    // with selectors keyed on actual ward-helper class `.pill-warn` and
    // Hebrew gender-form-tolerant regex (פגדולות vs גדול). v8 missed because
    // /גדול מדי/ literal didn't match the feminine-plural rendered string.
    const banner = await waitForWarningBanner(page, 4000);
    const hasError = banner.found;
    const crashed = session.crashed();

    if (!raised && !hasError && !crashed) {
      logBug('MEDIUM', scenario.scenario_id, 'adversarial-upload', `50MB upload accepted silently — no error banner found in 5s. dt=${dt}ms`);
    } else if (crashed) {
      logBug('CRITICAL', scenario.scenario_id, 'adversarial-upload', `50MB upload crashed page in ${dt}ms`);
    } else if (hasError) {
      console.log(`  adversarial: graceful failure ✓ banner via=${banner.via}: "${banner.text}" in ${dt}ms`);
    }

    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { dt, raised, hasError, crashed, bannerVia: banner.via };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'adversarial-upload', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Sub-bot scaffolds — each follows the runAdversarialUpload pattern.
// All accept (scenario, browser); return { ok, bugs } summary.
// MVP: each does the upload + checks for graceful UI feedback.
// ============================================================================

/** Sub-bot 1: synthetic lab-report PDF upload. Tests PDF path graceful behavior. */
async function runLabReportPDF(scenario, browser) {
  const session = await authedCaptureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page } = session;
  try {
    // Generate a tiny minimal PDF (header + EOF) — valid enough to parse, small enough to upload.
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF',
      'utf8'
    );
    const tmpPath = path.resolve(CONFIG.reportDir, `_lab_${scenario.scenario_id}.pdf`);
    await fs.writeFile(tmpPath, minimalPdf);

    // Find PDF input.
    const fileInputs = await page.locator('input[type="file"]').all();
    let pdfInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (accept && accept.includes('pdf')) { pdfInput = inp; break; }
    }
    if (!pdfInput) {
      logBug('LOW', scenario.scenario_id, 'lab-report-pdf', 'no PDF-accepting input found in DOM');
      await ctx.close();
      return { skipped: 'no_pdf_input' };
    }

    await pdfInput.setInputFiles(tmpPath, { timeout: 10_000 }).catch((err) => {
      logBug('MEDIUM', scenario.scenario_id, 'lab-report-pdf', `setInputFiles failed: ${err.message.slice(0, 100)}`);
    });
    await sleep(1500);
    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'lab-report-pdf', 'page crashed on minimal PDF');

    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'lab-report-pdf', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

/** Sub-bot 2: synthetic medical-image PNG upload. Tests image path graceful behavior. */
async function runMedicalImagePNG(scenario, browser) {
  const session = await authedCaptureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page } = session;
  try {
    // Generate a 1x1 transparent PNG (smallest valid). This tests that tiny images don't crash.
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    const tmpPath = path.resolve(CONFIG.reportDir, `_img_${scenario.scenario_id}.png`);
    await fs.writeFile(tmpPath, tinyPng);

    const fileInputs = await page.locator('input[type="file"]').all();
    let imgInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { imgInput = inp; break; }
    }
    if (!imgInput) {
      logBug('LOW', scenario.scenario_id, 'medical-image-png', 'no image-accepting input found in DOM');
      await ctx.close();
      return { skipped: 'no_image_input' };
    }

    await imgInput.setInputFiles(tmpPath, { timeout: 10_000 }).catch((err) => {
      logBug('MEDIUM', scenario.scenario_id, 'medical-image-png', `setInputFiles failed: ${err.message.slice(0, 100)}`);
    });
    await sleep(2000);
    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'medical-image-png', 'page crashed on 1x1 PNG');

    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'medical-image-png', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

/**
 * Generate a synthetic AZMA-style patient list image by rendering an HTML
 * table to PNG via Playwright's chromium screenshot. No new deps needed —
 * we already have Playwright. Returns the PNG buffer + the rows used.
 */
async function generateCensusPhoto(scenario, browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  // Mix the scenario patient with 3 generic mocks to give a realistic 4-row list.
  const d = scenario.demographics || {};
  const rows = [
    { name: d.name_he || 'מטופל א', tz: d.tz || '111111118', room: d.room || '12', bed: d.bed || 'A', age: d.age || 80 },
    { name: 'יעקב כהן', tz: '222222226', room: '15', bed: 'B', age: 75 },
    { name: 'שרה לוי', tz: '333333334', room: '20', bed: 'A', age: 88 },
    { name: 'דוד אברהם', tz: '444444442', room: '23', bed: 'B', age: 92 },
  ];
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Arial Hebrew', Arial, sans-serif; padding: 24px; background: #fff; color: #000; }
    h2 { margin: 0 0 16px 0; font-size: 22px; }
    table { border-collapse: collapse; width: 100%; font-size: 18px; }
    th, td { border: 1px solid #444; padding: 12px 16px; text-align: right; }
    th { background: #e8e8e8; font-weight: 700; }
    tr:nth-child(even) td { background: #f8f8f8; }
  </style>
</head>
<body>
  <h2>רשימת חולים — מחלקה גריאטרית</h2>
  <table>
    <tr><th>שם</th><th>ת.ז.</th><th>חדר</th><th>מיטה</th><th>גיל</th></tr>
    ${rows.map(r => `<tr><td>${r.name}</td><td>${r.tz}</td><td>${r.room}</td><td>${r.bed}</td><td>${r.age}</td></tr>`).join('\n    ')}
  </table>
</body>
</html>`;
  await page.setContent(html);
  await sleep(300); // let fonts load
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  await ctx.close();
  return { buf, rows };
}

/** Sub-bot 3: census-photo OCR roundtrip. Renders synthetic patient-list to PNG,
 * uploads via /census flow, watches for OCR-extracted rows. */
async function runCensusPhoto(scenario, browser) {
  // Generate synthetic census image first.
  let synth;
  try {
    synth = await generateCensusPhoto(scenario, browser);
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'census-photo', `synth-image-gen failed: ${err.message.slice(0, 100)}`);
    return { error: err.message };
  }
  const tmpPath = path.resolve(CONFIG.reportDir, `_census_${scenario.scenario_id}.png`);
  await fs.writeFile(tmpPath, synth.buf);

  const session = await captureContext(scenario, browser);
  if (!session.ok) {
    await fs.unlink(tmpPath).catch(() => {});
    return { skipped: session.error };
  }
  const { ctx, page } = session;
  try {
    // Navigate to /census. ward-helper uses hash routing.
    await page.evaluate(() => { window.location.hash = '#/census'; });
    await sleep(1000);
    // Find the file input — Census.tsx exposes one for image uploads.
    const fileInputs = await page.locator('input[type="file"]').all();
    let censusInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { censusInput = inp; break; }
    }
    if (!censusInput) {
      logBug('LOW', scenario.scenario_id, 'census-photo', 'no image-accepting file input on /census — route may have shifted');
      await fs.unlink(tmpPath).catch(() => {});
      await ctx.close();
      return { skipped: 'no_census_input' };
    }
    await censusInput.setInputFiles(tmpPath, { timeout: 15_000 }).catch((err) => {
      logBug('MEDIUM', scenario.scenario_id, 'census-photo', `setInputFiles failed: ${err.message.slice(0, 100)}`);
    });
    // After upload, the user must explicitly click "נתח רשימה" to start
    // OCR (Census.tsx:362). Without that click, no extraction happens.
    await sleep(1500);
    const analyzeBtn = page.getByRole('button', { name: /נתח רשימה/ }).first();
    if ((await analyzeBtn.count().catch(() => 0)) > 0) {
      await analyzeBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      console.log('  census-photo: clicked "נתח רשימה", waiting up to 30s for OCR...');
    } else {
      logBug('LOW', scenario.scenario_id, 'census-photo', '"נתח רשימה" button not found after upload — UI may have shifted');
    }
    // OCR via the proxy can take ~10-25s for a 4-row image. Wait + poll.
    const ocrStart = Date.now();
    while (Date.now() - ocrStart < 30_000) {
      await sleep(2000);
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const found = synth.rows.filter((r) => pageText.includes(r.tz)).length;
      if (found > 0) break;
    }
    if (session.crashed()) {
      logBug('CRITICAL', scenario.scenario_id, 'census-photo', 'page crashed during OCR roundtrip');
    } else {
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const found = synth.rows.filter((r) => pageText.includes(r.tz)).length;
      if (found === 0) {
        logBug('LOW', scenario.scenario_id, 'census-photo', `OCR returned 0/${synth.rows.length} synthetic rows — either OCR didn't fire, didn't extract, or output isn't rendered yet`);
      } else if (found < synth.rows.length) {
        logBug('MEDIUM', scenario.scenario_id, 'census-photo', `OCR extracted only ${found}/${synth.rows.length} synthetic rows — partial extraction`);
      } else {
        console.log(`  census-photo: OCR roundtrip ✓ ${found}/${synth.rows.length} rows extracted`);
      }
    }
    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true, rowsExpected: synth.rows.length };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'census-photo', `harness error: ${err.message}`);
    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

/**
 * Sub-bot 4: roster-import paste-flow. RosterImportModal has paste/ocr/manual
 * tabs — NO CSV file input. Use the paste tab with pipe-format text matching
 * the placeholder example. Tests the parse + preview pipeline end-to-end.
 */
async function runRosterImport(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page } = session;
  try {
    await page.evaluate(() => { window.location.hash = '#/today'; });
    await sleep(1000);

    // Click "⬆ ייבא רשומה" to open the modal (Today.tsx:267-271).
    const openBtn = page.getByRole('button', { name: /ייבא רשומה/ }).first();
    if ((await openBtn.count().catch(() => 0)) === 0) {
      logBug('LOW', scenario.scenario_id, 'roster-import', '"ייבא רשומה" opener button not found on /today — feature flag may be off');
      await ctx.close();
      return { skipped: 'opener_not_found' };
    }
    await openBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
    await sleep(800);

    // Modal opens on 'paste' tab by default. Find the textarea.
    const ta = page.locator('#roster-paste').first();
    if ((await ta.count().catch(() => 0)) === 0) {
      logBug('LOW', scenario.scenario_id, 'roster-import', 'paste textarea (#roster-paste) not visible after modal open');
      await ctx.close();
      return { skipped: 'no_textarea' };
    }
    // Pipe-format matching the placeholder: id | name | age | room | bed | los | dx
    const d = scenario.demographics || {};
    const lines = [
      `1 | ${d.name_he || 'מטופל א'} | ${d.age || 80} | ${d.room || '12'} | ${d.bed || 'A'} | 5 | hip fx`,
      '2 | יעקב כהן | 75 | 15 | B | 3 | CHF',
      '3 | שרה לוי | 88 | 20 | A | 7 | UTI + delirium',
      '4 | דוד אברהם | 92 | 23 | B | 2 | aspiration pneumonia',
    ];
    await ta.fill(lines.join('\n'));
    await sleep(500);

    // Click preview button "תצוגה מקדימה ←"
    const previewBtn = page.getByRole('button', { name: /תצוגה מקדימה/ }).first();
    if ((await previewBtn.count().catch(() => 0)) === 0) {
      logBug('LOW', scenario.scenario_id, 'roster-import', 'preview button "תצוגה מקדימה" not found after paste');
      await ctx.close();
      return { skipped: 'no_preview_btn' };
    }
    const isDisabled = await previewBtn.isDisabled().catch(() => false);
    if (isDisabled) {
      logBug('MEDIUM', scenario.scenario_id, 'roster-import', 'preview button stayed disabled after paste — parser failed to recognize pipe format');
    } else {
      await previewBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      await sleep(1500);
      // Verify preview phase: heading should change to include patient count.
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const found = lines.filter((l) => {
        const name = l.split('|')[1].trim();
        return pageText.includes(name);
      }).length;
      if (found === 0) {
        logBug('MEDIUM', scenario.scenario_id, 'roster-import', '0/4 patient names visible after preview click — parse may have failed silently');
      } else if (found < 4) {
        logBug('LOW', scenario.scenario_id, 'roster-import', `${found}/4 patient names in preview — partial parse`);
      } else {
        console.log(`  roster-import: paste-flow ✓ ${found}/4 names rendered in preview`);
      }
    }

    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'roster-import', 'page crashed during roster paste flow');
    await ctx.close();
    return { ok: true };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'roster-import', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// FIXTURE scenario — used when WARD_BOT_FIXTURE=1. Skips Opus generation
// and lets the harness be exercised end-to-end without API cost. The
// content is hand-written synthetic Hebrew with an INVALID-checksum tz.
// ============================================================================

function fixtureScenario(seedIdx) {
  const seed = SCENARIOS_SEEDS[seedIdx % SCENARIOS_SEEDS.length];
  // Verified: "111111118" tz fails Israeli MOH checksum. 1+2+1+2+1+2+1+2+8 = 20, mod 10 = 0
  // Hmm 20 mod 10 = 0 — so this is VALID. Use 111111111: digits w/weights = 1+2+1+2+1+2+1+2+1 = 13 — invalid.
  return {
    scenario_id: `fix-${seedIdx}-${Date.now()}`,
    _seed: seed,
    _dayCount: 3,
    demographics: { name_he: 'אסתר כהן-לוי', tz: '111111111', age: 84, sex: 'F', room: '12', bed: 'A' },
    chief_complaint: 'מטופלת בת 84 התקבלה עם ירידה בתפקוד וחום נמוך, חשד ל-UTI עם דליריום.',
    admission_note: {
      S: 'בת 84, גרה עם בעלה בדירת 2 חדרים, עצמאית בעבר ב-ADL. בני המשפחה מדווחים על ירידה בערנות מ-48 שעות, חוסר תיאבון, חולשה כללית. ללא כאבי חזה, ללא קוצר נשימה. שתן עכור לפי הבעל.',
      O: 'BP 132/74, HR 98, T 37.9, SpO2 96% RA. ערה אך מבולבלת לזמן. ריאות נקיות. בטן רכה. CVA tenderness שמאל. WBC 14.7, CRP 112, Cr 1.6, urinalysis: leukocytes 3+, nitrites positive.',
      A: '1) UTI עם דליריום ב-84yo. 2) AKI על רקע התייבשות. 3) חולשה כללית.',
      P: 'Ceftriaxone 1g IV q24h. Hydration NS 1.5L/day. Reassess Cr daily. CAM-screening q-shift. PT consult.',
    },
    soap_rounds: [
      { day: 2, S: 'יותר ערה בבוקר, אכלה ארוחת בוקר בשלמותה.', O: 'T 37.2, BP 124/70. WBC 11.8.', A: 'משפר.', P: 'המשך antibiotics, יום 2/7.' },
      { day: 3, S: 'דליריום נמוג. שמח לראות נכדה.', O: 'T 36.8, ערנות מלאה. Cr 1.2.', A: 'משופר משמעותית.', P: 'PO step-down ל-Cefuroxime 500mg bid x5d. תכנון שחרור.' },
    ],
    consult_letters: [
      { from: 'Geriatrics', to: 'Urology', body: 'בת 84 עם UTI חוזר, מבקשים הערכה לחסימה תחתונה.' },
    ],
    discharge_letter: {
      summary: 'אשפוז של 4 ימים בשל UTI עם דליריום, AKI טרום-כלייתי. השתפרה לחלוטין.',
      meds_at_discharge: 'Cefuroxime 500mg bid x3 ימים נוספים. Pantoprazole 20mg PO qd. Atorvastatin 20mg PO qhs.',
      follow_up: 'מרפאת גריאטריה 2 שבועות. תרבית שתן ביקורת.',
    },
  };
}

// ============================================================================
// Sub-bot 5: ADMISSION-EMIT FLOW
// Synthetic AZMA → upload on /capture → wait for extract → continue to
// /review → /edit → click "📋 העתק הכל" → read clipboard → verify the
// wrapForChameleon RLM/LRM markers are present.
//
// This is the headline ward-helper journey. v1 never exercised it.
// ============================================================================

async function runAdmissionEmit(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page, diag } = session;
  try {
    // Generate a synthetic AZMA-style chart PNG of THIS scenario's patient.
    let azmaPng;
    try {
      azmaPng = await generatePatientChart(scenario, browser);
    } catch (err) {
      logBug('HIGH', scenario.scenario_id, 'admission-emit/azma-gen', `synth-image failed: ${err.message.slice(0, 100)}`);
      await ctx.close();
      return { error: 'azma_gen' };
    }
    const tmpPath = path.resolve(CONFIG.reportDir, `_azma_${scenario.scenario_id}.png`);
    await fs.writeFile(tmpPath, azmaPng);

    // Find image input on /capture (default route).
    const fileInputs = await page.locator('input[type="file"]').all();
    let imageInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { imageInput = inp; break; }
    }
    if (!imageInput) {
      logBug('LOW', scenario.scenario_id, 'admission-emit/no-input', 'no image input on /capture landing');
      await fs.unlink(tmpPath).catch(() => {});
      await ctx.close();
      return { skipped: 'no_input' };
    }

    const tUpload = Date.now();
    await imageInput.setInputFiles(tmpPath, { timeout: 15_000 }).catch((err) => {
      logBug('MEDIUM', scenario.scenario_id, 'admission-emit/upload', `setInputFiles failed: ${err.message.slice(0, 100)}`);
    });
    diag.markAck('image-upload', tUpload);

    // Click "המשך לבדיקה ←" — this is the navigate-to-review button on
    // Capture.tsx. Without this click the extract pipeline doesn't fire.
    await sleep(rand(800, 1500));
    const proceedBtn = page.getByRole('button', { name: /המשך לבדיקה|continue|next/i }).first();
    if ((await proceedBtn.count().catch(() => 0)) > 0) {
      const tProceed = Date.now();
      await proceedBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      diag.markAck('proceed-to-review', tProceed);
    } else {
      logBug('MEDIUM', scenario.scenario_id, 'admission-emit/no-proceed', '"המשך לבדיקה" button not found after upload');
    }

    // Two-phase wait: (a) URL navigates to /review, (b) extract finishes
    // (signaled by FieldRow rendering — confirm buttons or forward button
    // appear). Polling URL alone is insufficient because /review shows a
    // loading state ("מחכה ל-AI") while extract runs server-side.
    const tExtract = Date.now();
    let landed = null;
    // Phase A: wait up to 30s for hash change.
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const hash = await page.evaluate(() => location.hash).catch(() => '');
      if (hash.includes('/review') || hash.includes('/edit') || hash.includes('/save')) {
        landed = hash;
        break;
      }
    }
    if (!landed) {
      logBug('HIGH', scenario.scenario_id, 'admission-emit/no-nav', `30s after upload, still on ${await page.evaluate(() => location.hash)} — Capture didn't transition`);
      await fs.unlink(tmpPath).catch(() => {});
      await ctx.close();
      return { error: 'no_nav' };
    }
    diag.markAck('navigate-to-review', tExtract);

    // Phase B: if landed on /review, wait up to 90s for extract to finish.
    // Readiness = either FieldRow confirm button is rendered OR the "צור
    // טיוטת רשימה" forward button is rendered (regardless of disabled state).
    if (landed.includes('/review')) {
      const tFinish = Date.now();
      let extractReady = false;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const sig = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'))
            .map((b) => (b.textContent || '').trim());
          return {
            hasConfirm: btns.some((t) => /אישור ידני נדרש/.test(t)),
            hasForward: btns.some((t) => /צור טיוטת רשימה/.test(t)),
            isError: btns.some((t) => /חזרה לצילום/.test(t)) && document.body.innerText.includes('שגיאה'),
          };
        }).catch(() => ({ hasConfirm: false, hasForward: false, isError: false }));
        if (sig.hasConfirm || sig.hasForward || sig.isError) {
          extractReady = true;
          if (sig.isError) {
            logBug('LOW', scenario.scenario_id, 'admission-emit/extract-error',
              'extract returned an error state on /review (synthetic chart not recognized) — confirms graceful handling');
            await fs.unlink(tmpPath).catch(() => {});
            await ctx.close();
            return { ok: true, landedAt: landed, extractError: true };
          }
          break;
        }
      }
      if (!extractReady) {
        logBug('HIGH', scenario.scenario_id, 'admission-emit/extract-stall',
          '90s on /review with neither confirm nor forward button — extract turn stalled mid-flight');
        await fs.unlink(tmpPath).catch(() => {});
        await ctx.close();
        return { error: 'extract_stall' };
      }
      diag.markAck('extract-finish', tFinish);
    }

    // Drive forward to /edit if currently on /review.
    if (landed.includes('/review')) {
      // /review has FieldRow per-critical-field manual-confirm buttons that
      // gate the forward button. When the extract returns low confidence
      // (which is always the case for our synthetic chart), each row shows
      // "אישור ידני נדרש" — click them all before searching forward.
      const confirmBtns = page.getByRole('button', { name: /אישור ידני נדרש/ });
      const confirmCount = await confirmBtns.count().catch(() => 0);
      for (let c = 0; c < confirmCount; c++) {
        await confirmBtns.nth(c).click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
        await sleep(rand(150, 350));
      }
      if (confirmCount > 0) {
        console.log(`  admission-emit: clicked ${confirmCount} per-field confirm buttons`);
      }

      // Forward button on /review is "צור טיוטת רשימה ←" (Review.tsx:819).
      // It enables only after all critical fields are confirmed.
      const reviewProceed = page.getByRole('button', { name: /צור טיוטת רשימה|המשך|generate|emit/i }).first();
      if ((await reviewProceed.count().catch(() => 0)) > 0) {
        const isDisabled = await reviewProceed.isDisabled().catch(() => false);
        if (isDisabled) {
          logBug('LOW', scenario.scenario_id, 'admission-emit/review-blocked',
            'forward button "צור טיוטת רשימה" still disabled after clicking all confirm buttons — extract may have flagged extra critical fields');
        }
        const tEmit = Date.now();
        await reviewProceed.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
        // Poll for /edit.
        for (let i = 0; i < 60; i++) {
          await sleep(1000);
          const hash = await page.evaluate(() => location.hash).catch(() => '');
          if (hash.includes('/edit') || hash.includes('/save')) { landed = hash; break; }
        }
        diag.markAck('emit-turn', tEmit);
      }
    }

    if (!landed.includes('/edit') && !landed.includes('/save')) {
      // Dump diagnostic info: visible buttons + first 400 chars of page text
      // so the operator can see what UI state the bot is actually facing.
      const stuckInfo = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
          .map((b) => ({
            text: (b.textContent || '').trim().slice(0, 60),
            disabled: b.disabled,
            ariaLabel: b.getAttribute('aria-label')?.slice(0, 60) || null,
          }))
          .filter((b) => b.text.length > 0);
        const bodyText = (document.body.innerText || '').slice(0, 400);
        return { btns, bodyText };
      }).catch(() => null);
      const evidence = stuckInfo
        ? `buttons=${JSON.stringify(stuckInfo.btns).slice(0, 350)} | body="${stuckInfo.bodyText.replace(/\s+/g, ' ').slice(0, 200)}"`
        : 'eval-failed';
      logBug('MEDIUM', scenario.scenario_id, 'admission-emit/no-edit',
        `did not reach /edit; stuck at ${landed}`, evidence);
    }

    // CLIPBOARD VERIFICATION — this is the headline new check.
    // Find any "📋 העתק" button (full or per-section) and click it.
    const copyBtn = page.getByRole('button', { name: /העתק|copy/i }).first();
    if ((await copyBtn.count().catch(() => 0)) === 0) {
      logBug('MEDIUM', scenario.scenario_id, 'admission-emit/no-copy-btn', 'no "📋 העתק" button found after emit');
    } else {
      await copyBtn.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      await sleep(600);
      const clipText = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch (_) { return null; }
      }).catch(() => null);
      if (!clipText) {
        logBug('HIGH', scenario.scenario_id, 'admission-emit/clipboard-empty', 'clipboard.readText returned null/empty after copy');
      } else {
        const hasBidiMark = BIDI_MARKS_RE.test(clipText);
        if (!hasBidiMark) {
          logBug('HIGH', scenario.scenario_id, 'admission-emit/clipboard-no-bidi',
            'wrapForChameleon regression: copied note has no UAX-9 directional marks ' +
            '— Chameleon paste will corrupt mixed Hebrew/English text');
        } else {
          console.log(`  admission-emit: clipboard ✓ ${clipText.length} chars, hasBidiMark=true`);
        }
        // Also flag if the text contains the dangerous chars sanitizer should remove.
        const arrows = clipText.match(/[→←↑↓]/g);
        const bold = clipText.match(/\*\*[^*]/);
        if (arrows) {
          logBug('MEDIUM', scenario.scenario_id, 'admission-emit/sanitizer-leak',
            `arrow chars (${arrows.length}) survived sanitizeForChameleon → will corrupt Chameleon`);
        }
        if (bold) {
          logBug('MEDIUM', scenario.scenario_id, 'admission-emit/sanitizer-leak',
            '**bold** markdown survived sanitizeForChameleon');
        }
      }
    }

    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'admission-emit', 'page crashed during admission emit');
    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true, landedAt: landed };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'admission-emit', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Sub-bot 6: SOAP DAILY ROUND on /today
// Use the roster paste flow to seed patients, navigate to /today, click the
// first patient card, simulate a per-patient interaction. Tests the multi-
// patient hand-off that didn't exist in v1.
// ============================================================================

async function runSoapDailyRound(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page, diag } = session;
  try {
    await page.evaluate(() => { window.location.hash = '#/today'; });
    await sleep(1200);

    // Seed roster via paste flow (reuses the runRosterImport pattern but
    // doesn't gate on its outcome).
    const openBtn = page.getByRole('button', { name: /ייבא רשומה/ }).first();
    if ((await openBtn.count().catch(() => 0)) === 0) {
      logBug('LOW', scenario.scenario_id, 'soap-round/no-roster-import', '"ייבא רשומה" button not found on /today — feature flag off?');
    } else {
      await openBtn.click().catch(() => {});
      await sleep(800);
      const ta = page.locator('#roster-paste').first();
      if ((await ta.count().catch(() => 0)) > 0) {
        const d = scenario.demographics || {};
        const lines = [
          `1 | ${d.name_he || 'מטופלת א'} | ${d.age || 84} | ${d.room || '12'} | ${d.bed || 'A'} | 4 | UTI + delirium`,
          '2 | יעקב כהן | 75 | 15 | B | 3 | CHF exacerbation',
          '3 | שרה לוי | 88 | 20 | A | 7 | post-stroke rehab',
        ];
        await ta.fill(lines.join('\n'));
        await sleep(400);
        const previewBtn = page.getByRole('button', { name: /תצוגה מקדימה/ }).first();
        if ((await previewBtn.count().catch(() => 0)) > 0 && !(await previewBtn.isDisabled().catch(() => false))) {
          await previewBtn.click().catch(() => {});
          await sleep(1200);
          // Confirm import — common pattern is "ייבא X חולים" or similar.
          const importBtn = page.getByRole('button', { name: /^ייבא\s|^שמור|^אישור|^הוסף|confirm/i }).first();
          if ((await importBtn.count().catch(() => 0)) > 0) {
            await importBtn.click().catch(() => {});
            await sleep(1200);
          } else {
            logBug('LOW', scenario.scenario_id, 'soap-round/no-import-confirm', 'no confirm button found in roster preview');
          }
        }
      }
    }

    // Now /today should show patient cards. Find the first one and click it.
    await sleep(800);
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const seenName = (scenario.demographics?.name_he && pageText.includes(scenario.demographics.name_he)) ||
                     pageText.includes('יעקב כהן') ||
                     pageText.includes('שרה לוי');
    if (!seenName) {
      logBug('MEDIUM', scenario.scenario_id, 'soap-round/no-patients-rendered',
        'after roster import, no patient names visible on /today — import or render failed silently');
      await ctx.close();
      return { skipped: 'no_patients_rendered' };
    }

    // Click the first card by Hebrew name. The patient name is the most
    // robust selector — card class names change.
    const firstName = scenario.demographics?.name_he || 'מטופלת א';
    const card = page.getByText(new RegExp(firstName)).first();
    if ((await card.count().catch(() => 0)) > 0) {
      const tClick = Date.now();
      await card.click({ timeout: CONFIG.actionTimeoutMs }).catch(() => {});
      diag.markAck('patient-card-click', tClick);
      await sleep(1500);
      // After click, expect navigation to /capture or some patient-detail
      // mode. Just check we didn't crash and that the URL changed or a new
      // section rendered.
      const hash = await page.evaluate(() => location.hash).catch(() => '');
      if (hash.includes('/today')) {
        // Some flows keep us on /today but expand a card. That's also OK
        // — just confirm the patient is in some "active" state.
        const expanded = await page.evaluate(
          (n) => Array.from(document.querySelectorAll('[aria-expanded="true"]')).length > 0 || document.body.innerText.includes(n),
          firstName,
        ).catch(() => false);
        if (!expanded) {
          logBug('LOW', scenario.scenario_id, 'soap-round/click-no-effect',
            `patient card click did not navigate or expand — still on ${hash}`);
        }
      }
    } else {
      logBug('MEDIUM', scenario.scenario_id, 'soap-round/no-card', `could not find clickable patient card for "${firstName}"`);
    }

    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'soap-round', 'page crashed during SOAP round');
    await ctx.close();
    return { ok: true };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'soap-round', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Sub-bot 7: CHOPPY-SCREENSHOT (rotated/blurred/JPEG-compressed AZMA)
// Real ward photos are taken at 5-15° angles, low light, JPEG quality 30-60.
// This sub-bot exercises that code path; v1 only ever uploaded clean PNGs.
// ============================================================================

async function runChoppyAzmaUpload(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page, diag } = session;
  try {
    let cleanPng;
    try {
      cleanPng = await generatePatientChart(scenario, browser);
    } catch (err) {
      logBug('MEDIUM', scenario.scenario_id, 'choppy/azma-gen', err.message.slice(0, 100));
      await ctx.close();
      return { error: 'azma_gen' };
    }
    let choppyJpg;
    try {
      choppyJpg = await distortImage(cleanPng, browser);
    } catch (err) {
      logBug('MEDIUM', scenario.scenario_id, 'choppy/distort', err.message.slice(0, 120));
      await ctx.close();
      return { error: 'distort' };
    }
    const tmpPath = path.resolve(CONFIG.reportDir, `_choppy_${scenario.scenario_id}.jpg`);
    await fs.writeFile(tmpPath, choppyJpg);

    const fileInputs = await page.locator('input[type="file"]').all();
    let imgInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { imgInput = inp; break; }
    }
    if (!imgInput) {
      logBug('LOW', scenario.scenario_id, 'choppy/no-input', 'no image input on /capture');
      await fs.unlink(tmpPath).catch(() => {});
      await ctx.close();
      return { skipped: 'no_input' };
    }

    const t0 = Date.now();
    await imgInput.setInputFiles(tmpPath, { timeout: 15_000 }).catch((err) => {
      logBug('MEDIUM', scenario.scenario_id, 'choppy/upload', `setInputFiles failed: ${err.message.slice(0, 100)}`);
    });
    diag.markAck('choppy-upload', t0);

    // The compress.ts utility should auto-downsize. Confirm the page didn't
    // crash and a thumbnail or status indicator appeared.
    await sleep(2500);
    if (session.crashed()) {
      logBug('CRITICAL', scenario.scenario_id, 'choppy/crash', `page crashed on choppy JPEG (${(choppyJpg.length / 1024).toFixed(0)} KB)`);
    } else {
      // Check for an error banner; absence + non-crash = handled gracefully.
      const errBanner = await page.locator('[class*="warn"], [class*="error"]').count().catch(() => 0);
      if (errBanner > 0) {
        const errText = await page.locator('[class*="warn"], [class*="error"]').first().textContent().catch(() => '');
        if (errText && /error|שגיאה|invalid/i.test(errText)) {
          logBug('LOW', scenario.scenario_id, 'choppy/error-banner',
            `choppy JPEG triggered an error banner: "${errText.slice(0, 100)}" — should be tolerated by compress.ts`);
        }
      }
      console.log(`  choppy-upload: ✓ ${(choppyJpg.length / 1024).toFixed(0)} KB JPEG handled without crash`);
    }

    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true, sizeKb: Math.round(choppyJpg.length / 1024) };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'choppy', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Sub-bot 8: DISCHARGE NOTE FLOW
// Like admission-emit but with discharge note type. Tests the per-note-type
// prompt prefix path (orchestrate.ts:prefixForType).
// ============================================================================

async function runDischargeNote(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page, diag } = session;
  try {
    let azmaPng;
    try {
      azmaPng = await generatePatientChart(scenario, browser);
    } catch (err) {
      logBug('LOW', scenario.scenario_id, 'discharge/azma-gen', err.message.slice(0, 100));
      await ctx.close();
      return { error: 'azma_gen' };
    }
    const tmpPath = path.resolve(CONFIG.reportDir, `_discharge_${scenario.scenario_id}.png`);
    await fs.writeFile(tmpPath, azmaPng);

    const fileInputs = await page.locator('input[type="file"]').all();
    let imageInput = null;
    for (const inp of fileInputs) {
      const accept = await inp.getAttribute('accept').catch(() => '');
      if (!accept || accept.startsWith('image')) { imageInput = inp; break; }
    }
    if (!imageInput) {
      await fs.unlink(tmpPath).catch(() => {});
      await ctx.close();
      return { skipped: 'no_input' };
    }
    await imageInput.setInputFiles(tmpPath, { timeout: 15_000 }).catch(() => {});

    // Look for a "type" picker that includes "סיכום שחרור" / "discharge".
    // If not found, fall back to whatever default — capture surfaces the
    // type via a select or radio group. This intentionally probes the UI.
    await sleep(1200);
    const typePicker = page.getByRole('combobox').first();
    let dischargeSelected = false;
    if ((await typePicker.count().catch(() => 0)) > 0) {
      const options = await page.locator('option').allTextContents().catch(() => []);
      const dischargeOpt = options.find((t) => /שחרור|discharge/.test(t));
      if (dischargeOpt) {
        await typePicker.selectOption({ label: dischargeOpt }).catch(() => {});
        dischargeSelected = true;
      }
    }
    if (!dischargeSelected) {
      // Try a button or radio matching discharge.
      const dischargeBtn = page.getByRole('radio', { name: /שחרור|discharge/i }).first();
      if ((await dischargeBtn.count().catch(() => 0)) > 0) {
        await dischargeBtn.click().catch(() => {});
        dischargeSelected = true;
      }
    }
    if (!dischargeSelected) {
      logBug('LOW', scenario.scenario_id, 'discharge/no-type-picker',
        'could not find a discharge-type selector on /capture — note-type may be inferred elsewhere');
    }

    // Continue.
    const proceedBtn = page.getByRole('button', { name: /המשך|continue/i }).first();
    if ((await proceedBtn.count().catch(() => 0)) > 0) {
      const t0 = Date.now();
      await proceedBtn.click().catch(() => {});
      diag.markAck('discharge-proceed', t0);
    }
    await sleep(2000);

    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'discharge', 'page crashed during discharge flow');
    await fs.unlink(tmpPath).catch(() => {});
    await ctx.close();
    return { ok: true, dischargeSelected };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'discharge', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Sub-bot 9: MOBILE LAYOUT AUDIT
// Visits each top-level route on iPhone 13 (390×844 viewport) and flags any
// element extending past viewport edges or causing horizontal body scroll.
// Caught the bottom-nav-vs-6-items overflow user reported 2026-05-10.
// ============================================================================

const ROUTES_TO_AUDIT = ['/', '/today', '/consult', '/history', '/ortho', '/settings'];

async function runMobileLayoutAudit(scenario, browser) {
  const session = await captureContext(scenario, browser);
  if (!session.ok) return { skipped: session.error };
  const { ctx, page } = session;
  try {
    const findings = [];
    // Seed roster so /today shows non-empty cards (also exposes cascading
    // overflow from card width). Long Hebrew names + long dxShort exercise
    // RTL truncation/overflow paths the empty state hides.
    await page.evaluate(async () => {
      try {
        const open = (n) => new Promise((res, rej) => {
          const r = indexedDB.open(n);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const db = await open('ward-helper').catch(() => null);
        if (db && db.objectStoreNames.contains('roster')) {
          const tx = db.transaction('roster', 'readwrite');
          const store = tx.objectStore('roster');
          store.clear();
          const rows = [
            { id: 'ml1', name: 'מטופל ארוך-שם-לבדיקת-עומס-RTL', age: 84, room: '12', bed: 'A', losDays: 4, dxShort: 'UTI עם דליריום + AKI prerenal', sourceMode: 'paste', addedAt: Date.now(), tz: null, sex: null },
            { id: 'ml2', name: 'יעקב כהן', age: 75, room: '15', bed: 'B', losDays: 3, dxShort: 'CHF NYHA III, fluid overload, hypoxia, dyspnea on exertion', sourceMode: 'paste', addedAt: Date.now(), tz: null, sex: null },
            { id: 'ml3', name: 'שרה לוי', age: 88, room: '20', bed: 'A', losDays: 7, dxShort: 'post-stroke rehab dysphagia aspiration risk significantly impaired ADL function', sourceMode: 'paste', addedAt: Date.now(), tz: null, sex: null },
          ];
          for (const r of rows) store.put(r);
          await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
        }
      } catch (_) {}
    });
    // /today reads roster from IDB on mount via useEffect; without a reload
    // the freshly-seeded rows aren't reflected in React state. Reload now
    // so the rest of the audit visits a populated /today, exposing
    // patient-card / header-strip overflow.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1200);

    for (const route of ROUTES_TO_AUDIT) {
      await page.evaluate((r) => { window.location.hash = '#' + r; }, route);
      await sleep(rand(900, 1400));
      const result = await page.evaluate(() => {
        // Always compare against the device viewport, NOT window.innerWidth
        // — when content forces body wider than viewport, innerWidth grows.
        const VW = 390;
        const overs = [];
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Skip the host html/body/outermost wrappers — their offset is a
          // SYMPTOM of inner overflow; reporting them noisifies.
          if (el === document.documentElement || el === document.body) continue;
          // Only report tagged candidates: buttons, nav, cards, headers,
          // anchors. The whole-tree dump is too noisy.
          const tag = el.tagName;
          const cls = String(el.className || '');
          const role = el.getAttribute('role') || '';
          const interesting =
            tag === 'BUTTON' || tag === 'A' || tag === 'NAV' || tag === 'HEADER' ||
            /\b(card|toolbar|bottom-nav|today-meta|today-soap|empty)\b/i.test(cls) ||
            /toolbar|navigation|alert/i.test(role);
          if (!interesting) continue;
          const overR = r.right > VW + 1;
          const overL = r.left < -1;
          if (overR || overL) {
            overs.push({
              tag, cls: cls.slice(0, 50),
              text: (el.innerText || '').slice(0, 40).replace(/\s+/g, ' '),
              left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
              over: overR ? 'right' : 'left',
            });
          }
        }
        return {
          bodyHorizontalScroll: document.body.scrollWidth > document.body.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          overflowingElements: overs,
        };
      }).catch(() => null);

      if (result && result.bodyHorizontalScroll) {
        // The whole page has horizontal scroll — first-class layout bug.
        // Report the wider element (likely the cause).
        const widest = (result.overflowingElements || [])
          .sort((a, b) => b.width - a.width)[0];
        logBug('MEDIUM', scenario.scenario_id, `mobile-layout/${route}/h-scroll`,
          `body scrollWidth ${result.bodyScrollWidth}px > 390px viewport. ${result.overflowingElements.length} interesting elements overflow. Widest: ${widest ? `<${widest.tag} class="${widest.cls}"> ${widest.width}px ("${widest.text}")` : 'none'}`);
        findings.push({ route, body: result.bodyScrollWidth, overflows: result.overflowingElements.length });
      } else if (result && result.overflowingElements?.length) {
        // No body-wide scroll but individual elements still spill out.
        for (const o of result.overflowingElements.slice(0, 3)) {
          logBug('LOW', scenario.scenario_id, `mobile-layout/${route}/element-clip`,
            `<${o.tag} class="${o.cls}"> overflows ${o.over} edge: x=[${o.left}, ${o.right}], width=${o.width} (text: "${o.text}")`);
        }
        findings.push({ route, body: 0, overflows: result.overflowingElements.length });
      }
    }
    if (session.crashed()) logBug('CRITICAL', scenario.scenario_id, 'mobile-layout', 'page crashed during route audit');
    await ctx.close();
    return { ok: true, findings };
  } catch (err) {
    logBug('HIGH', scenario.scenario_id, 'mobile-layout', `harness error: ${err.message}`);
    await ctx.close().catch(() => {});
    return { error: err.message };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  await fs.mkdir(CONFIG.reportDir, { recursive: true });
  console.log(`ward-helper-bot-v1 starting`);
  console.log(`  url=${CONFIG.url} scenarios=${CONFIG.scenarios} model=${CONFIG.model}`);
  console.log(`  cost-cap=$${CONFIG.costCapUsd} effort=${process.env.CHAOS_EFFORT || 'medium'}`);
  console.log(`  report=${REPORT_PATH}`);

  // CHAOS_EXECUTABLE_PATH lets us fall back to a system-installed Chrome on
  // Windows when Playwright's bundled chromium hasn't been downloaded
  // (`npx playwright install` not run). Standard path on Windows is
  // C:\Program Files\Google\Chrome\Application\chrome.exe.
  const launchOpts = { headless: CONFIG.headless };
  if (process.env.CHAOS_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.CHAOS_EXECUTABLE_PATH;
    launchOpts.channel = undefined;  // override default chromium channel
  }
  const browser = await chromium.launch(launchOpts);

  for (let i = 0; i < CONFIG.scenarios; i++) {
    if (totalUsd() >= CONFIG.costCapUsd) { console.warn('cost-cap hit, stopping early'); break; }
    let scenario;
    try {
      scenario = CONFIG.useFixture ? fixtureScenario(i) : await generateScenario(i);
    } catch (err) {
      logBug('HIGH', `seed-${i}`, 'scenario-generate', err.message);
      continue;
    }
    await persistScenario(scenario);

    // ────────── v2 sub-bots (default — these are the new headline flows) ──────────
    const journey = await runPlaywrightFlow(scenario, browser);
    const layout = await runMobileLayoutAudit(scenario, browser);
    const admission = await runAdmissionEmit(scenario, browser);
    const soap = await runSoapDailyRound(scenario, browser);
    const choppy = await runChoppyAzmaUpload(scenario, browser);
    const discharge = await runDischargeNote(scenario, browser);

    // ────────── v1 legacy sub-bots — opt-in via WARD_BOT_LEGACY=1 ──────────
    let adversarial, labPdf, imagePng, census, roster;
    if (CONFIG.runLegacy) {
      adversarial = await runAdversarialUpload(scenario, browser);
      labPdf = await runLabReportPDF(scenario, browser);
      imagePng = await runMedicalImagePNG(scenario, browser);
      census = await runCensusPhoto(scenario, browser);
      roster = await runRosterImport(scenario, browser);
    }

    const sBugs = BUGS.filter((b) => b.scenario_id === scenario.scenario_id).length;
    console.log(
      `  scenario ${i + 1} done — bugs: ${sBugs}, journey=${journey?.success}, ` +
      `layout=${layout?.ok ? `${layout.findings.length} routes-w-overflow` : (layout?.error || layout?.skipped)}, ` +
      `admission=${admission?.ok ? 'ok' : (admission?.error || admission?.skipped)}, ` +
      `soap=${soap?.ok ? 'ok' : (soap?.error || soap?.skipped)}, ` +
      `choppy=${choppy?.ok ? `ok-${choppy.sizeKb}KB` : (choppy?.error || choppy?.skipped)}, ` +
      `discharge=${discharge?.ok ? 'ok' : (discharge?.error || discharge?.skipped)}` +
      (CONFIG.runLegacy
        ? ` | legacy: adv-crashed=${adversarial?.crashed || false}, lab=${labPdf?.ok || labPdf?.skipped}, img=${imagePng?.ok || imagePng?.skipped}, census=${census?.skipped || 'ok'}, roster=${roster?.ok || roster?.skipped}`
        : '')
    );
  }

  await browser.close();
  await writeReport();

  console.log(`\n=== ward-helper-bot-v1 complete ===`);
  console.log(`Cost: $${totalUsd().toFixed(2)} (${COST.calls} calls)`);
  console.log(`Bugs: ${BUGS.length} total — see ${REPORT_PATH}`);
}

async function writeReport() {
  const lines = [];
  lines.push(`# ward-helper-bot-v1 report — ${RUN_ID}`);
  lines.push('');
  lines.push(`- Model: ${CONFIG.model}, effort: ${process.env.CHAOS_EFFORT || 'medium'}`);
  lines.push(`- Scenarios: ${CONFIG.scenarios}${CONFIG.useFixture ? ' (FIXTURE — Opus skipped)' : ''}`);
  lines.push(`- Mobile device: ${MOBILE_DEVICE.name || 'iPhone 13'} (${MOBILE_DEVICE.viewport.width}×${MOBILE_DEVICE.viewport.height}, isMobile=${MOBILE_DEVICE.isMobile}, hasTouch=${MOBILE_DEVICE.hasTouch})`);
  lines.push(`- Legacy sub-bots: ${CONFIG.runLegacy ? 'enabled (WARD_BOT_LEGACY=1)' : 'disabled'}`);
  lines.push(`- Cost: $${totalUsd().toFixed(2)} (${COST.calls} calls, ${COST.inTok}/${COST.outTok} tokens)`);
  lines.push(`- Bugs: ${BUGS.length}`);
  lines.push('');
  lines.push('## Bug summary by severity');
  const sevCounts = BUGS.reduce((a, b) => { a[b.severity] = (a[b.severity] || 0) + 1; return a; }, {});
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    if (sevCounts[sev]) lines.push(`- **${sev}**: ${sevCounts[sev]}`);
  }
  lines.push('');
  lines.push('## Bug summary by flow');
  // Group by the prefix of `where` (e.g. "admission-emit/...", "soap-round/...").
  const byFlow = {};
  for (const b of BUGS) {
    const flow = b.where.split('/')[0];
    byFlow[flow] = byFlow[flow] || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    byFlow[flow][b.severity] += 1;
  }
  lines.push('| flow | CRIT | HIGH | MED | LOW |');
  lines.push('|---|---|---|---|---|');
  for (const flow of Object.keys(byFlow).sort()) {
    const c = byFlow[flow];
    lines.push(`| ${flow} | ${c.CRITICAL} | ${c.HIGH} | ${c.MEDIUM} | ${c.LOW} |`);
  }
  lines.push('');
  lines.push('## Bug details');
  for (const b of BUGS) {
    lines.push(`### [${b.severity}] ${b.where} — ${b.scenario_id}`);
    lines.push(`- **What**: ${b.what}`);
    if (b.evidence) lines.push(`- **Evidence**: \`${String(b.evidence).slice(0, 300)}\``);
    lines.push(`- **At**: ${b.at}`);
    lines.push('');
  }
  lines.push('## Scenarios log');
  lines.push(`- jsonl: \`${SCENARIO_LOG_PATH}\``);
  await fs.writeFile(REPORT_PATH, lines.join('\n'), 'utf8');
}

main().catch((e) => { console.error('fatal:', e); process.exitCode = 1; });
