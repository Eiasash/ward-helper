#!/usr/bin/env node
/**
 * ward-helper-bot-v1 — synthetic-patient + upload-stress harness.
 *
 * Phase 7 implementation 2026-05-08. MVP scope:
 *   1. Scenario generator (Opus 4.7 + adaptive thinking) — real call.
 *   2. Persistence to public.synthetic_patients (schema applied 2026-05-08).
 *   3. Playwright login + register synthetic user + draft a SOAP note.
 *   4. Adversarial 50MB upload — single sub-bot of the planned 5.
 *   5. Bug-capture markdown report.
 *
 * NOT in MVP (deferred — port the Sub-Bot 1 pattern):
 *   - labReportPDF (synthetic CBC/CMP PDF generator)
 *   - medicalImagePNG (overlay-text image upload)
 *   - censusPhoto (OCR roundtrip with extracted-rows validation)
 *   - rosterImport (CSV ingest)
 *   - 4 of 5 adversarial upload variants (0-byte / wrong-MIME / corrupted-PDF / broken-EXIF)
 *
 * To run:
 *   WARD_BOT_RUN_AUTHORIZED=yes-i-reviewed CLAUDE_API_KEY=$key \
 *     WARD_BOT_SCENARIOS=1 node scripts/ward-helper-bot-v1.mjs
 *
 * Cost-cap: $60 default. Single scenario ≈ $1.50 (Opus 4.7 + thinking).
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

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
if (!KEY) { console.error('CLAUDE_API_KEY not set'); process.exit(2); }
if (KEY.length !== 108) {
  console.error(`CLAUDE_API_KEY length=${KEY.length}, expected 108 — fix env, retry.`);
  process.exit(2);
}

const SUPA_URL = process.env.SUPABASE_URL || 'https://krmlzwwelqvlfslwltol.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON || 'sb_publishable_tUuqQQ8RKMvLDwTz5cKkOg_o_y-rHtw';

const CONFIG = {
  url: process.env.WARD_BOT_URL || 'https://eiasash.github.io/ward-helper/',
  scenarios: Math.max(1, Number(process.env.WARD_BOT_SCENARIOS || 1)),
  costCapUsd: Number(process.env.CHAOS_COST_CAP_USD || 60),
  model: process.env.CHAOS_MODEL || 'claude-opus-4-7',
  thinkingBudget: Number(process.env.CHAOS_THINKING_BUDGET || 16000),
  reportDir: process.env.CHAOS_REPORT_DIR || 'chaos-reports/ward-bot-v1',
  headless: process.env.CHAOS_HEADLESS !== '0',
  navigationTimeoutMs: Number(process.env.WARD_BOT_NAV_TIMEOUT_MS || 30_000),
  actionTimeoutMs: Number(process.env.WARD_BOT_ACTION_TIMEOUT_MS || 5_000),
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
  const dayCount = rand(3, 7);
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
  // 64k output max; adaptive thinking can consume ~10-15k of budget on medium
  // effort, leaving plenty for the 5-8k token JSON. v5 truncated at 32k.
  const { text } = await callOpus({ system: SCENARIO_SYSTEM, user: userPrompt, maxTokens: 64000 });
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

async function runPlaywrightFlow(scenario, browser) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
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
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
  const page = await ctx.newPage();
  let crashed = false;
  page.on('pageerror', (err) => {
    crashed = true;
    logBug('CRITICAL', scenario.scenario_id, 'capture-context-pageerror', err.message);
  });
  await page.goto(CONFIG.url, { timeout: CONFIG.navigationTimeoutMs, waitUntil: 'domcontentloaded' });
  await sleep(800);

  const fileInputs = await page.locator('input[type="file"]').all();
  if (fileInputs.length === 0) {
    logBug('MEDIUM', scenario.scenario_id, 'capture-context', 'no file inputs on landing — UI may have shifted');
  }
  return { ok: true, ctx, page, crashed: () => crashed };
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
// Main
// ============================================================================

async function main() {
  await fs.mkdir(CONFIG.reportDir, { recursive: true });
  console.log(`ward-helper-bot-v1 starting`);
  console.log(`  url=${CONFIG.url} scenarios=${CONFIG.scenarios} model=${CONFIG.model}`);
  console.log(`  cost-cap=$${CONFIG.costCapUsd} effort=${process.env.CHAOS_EFFORT || 'medium'}`);
  console.log(`  report=${REPORT_PATH}`);

  const browser = await chromium.launch({ headless: CONFIG.headless });

  for (let i = 0; i < CONFIG.scenarios; i++) {
    if (totalUsd() >= CONFIG.costCapUsd) { console.warn('cost-cap hit, stopping early'); break; }
    let scenario;
    try {
      scenario = await generateScenario(i);
    } catch (err) {
      logBug('HIGH', `seed-${i}`, 'scenario-generate', err.message);
      continue;
    }
    await persistScenario(scenario);

    const journey = await runPlaywrightFlow(scenario, browser);
    const adversarial = await runAdversarialUpload(scenario, browser);
    const labPdf = await runLabReportPDF(scenario, browser);
    const imagePng = await runMedicalImagePNG(scenario, browser);
    const census = await runCensusPhoto(scenario, browser);
    const roster = await runRosterImport(scenario, browser);

    const sBugs = BUGS.filter((b) => b.scenario_id === scenario.scenario_id).length;
    console.log(
      `  scenario ${i + 1} done — bugs: ${sBugs}, journey=${journey?.success}, adv-crashed=${adversarial?.crashed || false}, ` +
      `lab=${labPdf?.ok || labPdf?.skipped}, img=${imagePng?.ok || imagePng?.skipped}, ` +
      `census=${census?.skipped || 'ok'}, roster=${roster?.ok || roster?.skipped}`
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
  lines.push(`- Scenarios: ${CONFIG.scenarios}`);
  lines.push(`- Cost: $${totalUsd().toFixed(2)} (${COST.calls} calls, ${COST.inTok}/${COST.outTok} tokens)`);
  lines.push(`- Bugs: ${BUGS.length}`);
  lines.push('');
  lines.push('## Bug summary');
  const sevCounts = BUGS.reduce((a, b) => { a[b.severity] = (a[b.severity] || 0) + 1; return a; }, {});
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    if (sevCounts[sev]) lines.push(`- **${sev}**: ${sevCounts[sev]}`);
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
