// Real-browser PWA simulation using system Chrome (channel: 'chrome').
// Richer than the chromium version: longer waits, deeper interactions,
// before/after-tap screenshots, full debug panel capture.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const REPOS = [
  { name: 'Geriatrics',       root: 'C:/Users/User/repos/Geriatrics',             page: 'shlav-a-mega.html', port: 8201 },
  { name: 'InternalMedicine', root: 'C:/Users/User/repos/InternalMedicine/dist',  page: 'pnimit-mega.html', port: 8202 },
  { name: 'FamilyMedicine',   root: 'C:/Users/User/repos/FamilyMedicine/dist',    page: 'mishpacha-mega.html', port: 8203 },
];

const findings = [];
const log = (repo, type, msg) => {
  const entry = { repo, type, msg: String(msg).slice(0, 800) };
  findings.push(entry);
  console.log(`[${repo}] [${type}] ${String(msg).slice(0, 250)}`);
};

async function startServer(root, port) {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-m', 'http.server', String(port)], {
      cwd: root, stdio: 'ignore', detached: false
    });
    setTimeout(() => resolve(proc), 1500);
  });
}

const SS_DIR = 'C:/Users/User/sim_screenshots';
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR);

async function simulate(repo, browser) {
  console.log(`\n========== ${repo.name} ==========`);
  const server = await startServer(repo.root, repo.port);

  try {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') log(repo.name, 'CONSOLE.ERROR', msg.text());
    });
    page.on('pageerror', (err) => log(repo.name, 'PAGE_ERROR', err.message));
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (/favicon|woff2|manifest\.json/.test(url)) return;  // cosmetic, skip
      log(repo.name, 'NET_FAIL', `${url.split('/').slice(-2).join('/')}`);
    });

    // Rewrite Vite base path requests
    const basePrefix = '/' + repo.name + '/';
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes(basePrefix)) {
        return route.continue({ url: url.replace(basePrefix, '/') });
      }
      route.continue();
    });

    const url = `http://localhost:${repo.port}/${repo.page}`;
    log(repo.name, 'INFO', `→ ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => log(repo.name, 'NAV_ERROR', e.message));

    // Generous wait for async data load
    await page.waitForTimeout(5000);

    // Sample state AFTER data load
    const state = await page.evaluate(() => ({
      appVersion: window.APP_VERSION ?? null,
      qzLen: (window.QZ ?? window.G?.QZ ?? []).length,
      hasG: typeof window.G !== 'undefined',
      hasDebug: typeof window.__debug !== 'undefined',
      hasNotes: !!(window.NOTES ?? window.G?.NOTES),
      drugsCount: (window.DRUGS ?? window.G?.DRUGS ?? []).length,
      flashcards: (window.FC ?? window.G?.FC ?? []).length,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 200),
    })).catch(e => ({ err: e.message }));
    log(repo.name, 'STATE', JSON.stringify(state));

    // Screenshot pre-tap
    await page.screenshot({ path: `${SS_DIR}/${repo.name}__01_loaded.png`, fullPage: false });
    log(repo.name, 'SS', '01_loaded.png saved');

    // === 5-tap top-right corner ===
    const vp = page.viewportSize();
    log(repo.name, 'INFO', `Tapping (${vp.width-20}, 20) ×5...`);
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(vp.width - 20, 20);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);

    // Screenshot during/after tap
    await page.screenshot({ path: `${SS_DIR}/${repo.name}__02_after_tap.png`, fullPage: false });
    log(repo.name, 'SS', '02_after_tap.png saved');

    // Capture debug panel content
    const debugInfo = await page.evaluate(() => {
      const sels = ['#__debug_panel', '#__debug-panel', '#debug-panel', '.debug-console', '#debug-overlay'];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          return { sel: s, text: el.innerText.slice(0, 2000), hidden: el.hidden };
        }
      }
      // Try invoking the API directly
      if (typeof window.__debug?.show === 'function') {
        try { window.__debug.show(); } catch {}
      }
      // Check again
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          return { sel: s + ' (after .show())', text: el.innerText.slice(0, 2000), hidden: el.hidden };
        }
      }
      return null;
    });
    if (debugInfo) {
      log(repo.name, 'DEBUG_PANEL', `${debugInfo.sel}\n${debugInfo.text.slice(0, 700)}`);
    } else {
      log(repo.name, 'DEBUG_PANEL', 'No visible debug panel');
    }

    // Try to get debug.report() output directly
    const report = await page.evaluate(() => {
      try {
        if (typeof window.__debug?.report === 'function') {
          return window.__debug.report();
        }
        return null;
      } catch (e) { return 'err: ' + e.message; }
    });
    if (report) log(repo.name, 'DEBUG_REPORT', String(report).slice(0, 1500));

    // Screenshot debug panel open
    await page.screenshot({ path: `${SS_DIR}/${repo.name}__03_debug_open.png`, fullPage: false });
    log(repo.name, 'SS', '03_debug_open.png saved');

    // === Try the quiz flow ===
    // First close debug panel if open
    await page.evaluate(() => {
      const closeBtn = [...document.querySelectorAll('button, .btn')].find(b => /✕|Close|סגור/.test(b.textContent));
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(300);

    // Click Quiz tab
    const quizClicked = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[data-tab], .tab-btn, .tab, button, a')]
        .filter(el => /^.{0,5}(Quiz|מבחן|שאלות).{0,5}$/i.test(el.textContent.trim()));
      if (tabs[0]) { tabs[0].click(); return tabs[0].textContent.trim().slice(0, 30); }
      return null;
    });
    log(repo.name, 'QUIZ', `tab-click: ${quizClicked}`);
    await page.waitForTimeout(1500);

    // Find first answer choice and click it (Geri uses inline onclick="pick(N)"; siblings use data-action)
    const answerClicked = await page.evaluate(() => {
      // Try modern selectors first
      let choices = document.querySelectorAll('[data-action="pick"], .quiz-choice, .choice');
      // Geri-specific: inline onclick="pick(N)" or data-i
      if (choices.length === 0) {
        choices = document.querySelectorAll('[onclick*="pick("], [data-i]');
      }
      // Last resort: option-styled buttons inside the quiz area
      if (choices.length === 0) {
        const q = document.querySelector('.q, .quiz, #quiz, [class*="quiz"]');
        if (q) choices = q.querySelectorAll('button, .btn');
      }
      if (choices.length === 0) return null;
      choices[0].click();
      return { count: choices.length, firstText: choices[0].textContent.slice(0, 80), selector: choices[0].outerHTML.slice(0, 120) };
    });
    log(repo.name, 'QUIZ', `answer-pick: ${JSON.stringify(answerClicked)}`);
    await page.waitForTimeout(800);

    // Click "check" / submit if exists
    const checked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-action="check-answer"], button')]
        .find(b => /check|בדוק|הצג|✓/i.test(b.textContent));
      if (btn) { btn.click(); return btn.textContent.slice(0, 40); }
      return null;
    });
    log(repo.name, 'QUIZ', `check-click: ${checked}`);
    await page.waitForTimeout(1000);

    // Screenshot after answer
    await page.screenshot({ path: `${SS_DIR}/${repo.name}__04_quiz.png`, fullPage: false });
    log(repo.name, 'SS', '04_quiz.png saved');

    // Final state assertions
    const final = await page.evaluate(() => {
      // Look for "correct" / "wrong" feedback
      const feedback = [...document.querySelectorAll('.quiz-feedback, [data-state]')].map(el => ({
        state: el.dataset?.state, text: el.textContent.slice(0, 100)
      }));
      return {
        feedback: feedback.slice(0, 3),
        bodyHasError: /Uncaught|TypeError|undefined/i.test(document.body.innerText),
      };
    });
    log(repo.name, 'FINAL', JSON.stringify(final));

    await ctx.close();
  } finally {
    try { server.kill('SIGKILL'); } catch {}
    try { spawn('taskkill', ['/F', '/PID', String(server.pid)]); } catch {}
  }
}

async function main() {
  // Try system Chrome first; fall back to chromium
  let browser;
  let usingChannel = '?';
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    usingChannel = 'system Chrome (channel:chrome, headed)';
  } catch (e) {
    console.log('System Chrome unavailable, falling back to bundled chromium:', e.message);
    browser = await chromium.launch({ headless: true });
    usingChannel = 'bundled chromium (headless)';
  }
  console.log(`Browser: ${usingChannel}\n`);

  for (const repo of REPOS) {
    try {
      await simulate(repo, browser);
    } catch (e) {
      log(repo.name, 'HARNESS_ERROR', e.message);
    }
  }
  await browser.close();

  console.log('\n\n=================== SUMMARY ===================');
  const byRepo = {};
  for (const f of findings) (byRepo[f.repo] ||= []).push(f);
  for (const [repo, list] of Object.entries(byRepo)) {
    const errs = list.filter(f => /ERROR|FAIL/.test(f.type));
    const debugOk = list.find(f => f.type === 'DEBUG_PANEL' && !f.msg.startsWith('No'));
    const stateOk = list.find(f => f.type === 'STATE' && /qzLen":\s*[1-9]/.test(f.msg));
    console.log(`\n${repo}:`);
    console.log(`  Browser sim ............ ${stateOk ? '✅ data loaded' : '❌ no data'}`);
    console.log(`  Debug console (5-tap) .. ${debugOk ? '✅ panel surfaced' : '⚠️  panel did not surface'}`);
    console.log(`  Net errors (excluding fonts/manifest): ${errs.length}`);
    for (const f of errs) console.log(`    [${f.type}] ${f.msg.slice(0,120)}`);
  }

  fs.writeFileSync('C:/Users/User/browser_sim_v2.json', JSON.stringify(findings, null, 2));
  console.log(`\nFull log:    C:/Users/User/browser_sim_v2.json`);
  console.log(`Screenshots: ${SS_DIR}/`);
  console.log(`  *__01_loaded.png   (initial load)`);
  console.log(`  *__02_after_tap.png (after 5-tap)`);
  console.log(`  *__03_debug_open.png (debug panel)`);
  console.log(`  *__04_quiz.png      (after quiz interaction)`);
}

main().catch(e => { console.error(e); process.exit(1); });
