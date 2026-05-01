// Live-URL performance + functional simulation of the 3 medical PWAs.
// Solves ~10 questions per app; captures timing, perf, errors, slow network, memory.

import { chromium } from '@playwright/test';
import fs from 'node:fs';

const REPOS = [
  { name: 'Geriatrics',       url: 'https://eiasash.github.io/Geriatrics/shlav-a-mega.html' },
  { name: 'InternalMedicine', url: 'https://eiasash.github.io/InternalMedicine/pnimit-mega.html' },
  { name: 'FamilyMedicine',   url: 'https://eiasash.github.io/FamilyMedicine/mishpacha-mega.html' },
];

const findings = [];
const log = (repo, type, msg, data) => {
  findings.push({ repo, type, msg: String(msg).slice(0, 800), data, ts: Date.now() });
  const dataStr = data ? ` ${JSON.stringify(data).slice(0, 200)}` : '';
  console.log(`[${repo}] [${type}] ${String(msg).slice(0, 200)}${dataStr}`);
};

const SS_DIR = 'C:/Users/User/sim_screenshots';
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR);

async function simulate(repo, browser) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━ ${repo.name} ━━━━━━━━━━━━━━━━━━━━`);
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();

  // Network instrumentation: collect slow requests + failures
  const slowRequests = [];
  const failedRequests = [];
  const requestTimes = new Map();
  page.on('request', (req) => requestTimes.set(req, Date.now()));
  page.on('response', (resp) => {
    const req = resp.request();
    const t = Date.now() - (requestTimes.get(req) ?? Date.now());
    if (t > 1000) slowRequests.push({ url: req.url().split('/').slice(-2).join('/'), t, status: resp.status() });
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    failedRequests.push({ url: req.url().split('/').slice(-2).join('/'), err: f ? f.errorText : '?' });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') log(repo.name, 'CONSOLE.ERROR', msg.text());
  });
  page.on('pageerror', (err) => log(repo.name, 'PAGE_ERROR', err.message));

  // ===== LOAD + TIMING =====
  const loadStart = Date.now();
  await page.goto(repo.url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => log(repo.name, 'NAV_ERROR', e.message));
  const loadMs = Date.now() - loadStart;
  log(repo.name, 'LOAD', `${loadMs}ms (networkidle)`);

  // Wait for SPA bootstrap
  await page.waitForTimeout(3000);

  // Performance metrics from window
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find(p => p.name === 'first-contentful-paint')?.startTime;
    const mem = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
    } : null;
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd | 0,
      loadEvent: nav?.loadEventEnd | 0,
      fcp: fcp ? Math.round(fcp) : null,
      transferSize: nav?.transferSize,
      decodedBodySize: nav?.decodedBodySize,
      memMB: mem,
      resourceCount: performance.getEntriesByType('resource').length,
    };
  });
  log(repo.name, 'PERF', '', perf);

  // App state
  const state = await page.evaluate(() => ({
    appVersion: window.APP_VERSION ?? null,
    qzLen: (window.QZ ?? window.G?.QZ ?? []).length,
    hasG: typeof window.G !== 'undefined',
    hasDebug: typeof window.__debug !== 'undefined',
  }));
  log(repo.name, 'STATE', '', state);

  // Initial screenshot
  await page.screenshot({ path: `${SS_DIR}/${repo.name}__perf_01_loaded.png` });

  // ===== NAVIGATE TO QUIZ =====
  const quizClickT = Date.now();
  const quizClicked = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-tab], .tab-btn, .tab, button, a')]
      .filter(el => /^.{0,5}(Quiz|מבחן|שאלות).{0,5}$/i.test(el.textContent.trim()));
    if (tabs[0]) { tabs[0].click(); return tabs[0].textContent.trim().slice(0, 30); }
    return null;
  });
  await page.waitForTimeout(800);
  log(repo.name, 'QUIZ_TAB', `${Date.now() - quizClickT}ms (clicked: ${quizClicked})`);

  // ===== SOLVE LOOP (~10 questions) =====
  const solveResults = { picked: 0, checked: 0, correct: 0, wrong: 0, advance: 0, errors: [], pickTimes: [], checkTimes: [] };
  for (let qIdx = 0; qIdx < 10; qIdx++) {
    try {
      // Pick a random choice via in-page eval (avoids Playwright actionability timeout on touch buttons)
      const t0 = Date.now();
      const pickResult = await page.evaluate(() => {
        const choices = document.querySelectorAll('[data-action="pick"], [onclick*="pick("], .quiz-choice, [data-i]');
        if (choices.length < 2) return { count: choices.length };
        const idx = Math.floor(Math.random() * Math.min(choices.length, 4));
        choices[idx].click();
        return { count: choices.length, idx, text: (choices[idx].textContent || '').slice(0, 60) };
      });
      solveResults.pickTimes.push(Date.now() - t0);
      if (pickResult.count >= 2) {
        solveResults.picked++;
      } else {
        solveResults.errors.push(`q${qIdx}: only ${pickResult.count} choices found`);
      }
      await page.waitForTimeout(200);

      // Click "check / בדוק" / "submit"
      const checkBtn = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-action="check-answer"], [onclick*="check"], button')]
          .find(b => /^.{0,3}(check|בדוק|הצג|submit).{0,5}$/i.test(b.textContent.trim()));
        if (btn) { btn.click(); return btn.textContent.trim().slice(0, 30); }
        return null;
      });
      if (checkBtn) {
        const t0 = Date.now();
        await page.waitForTimeout(400);
        solveResults.checkTimes.push(Date.now() - t0);
        solveResults.checked++;

        // Detect correct/wrong from DOM state
        const result = await page.evaluate(() => {
          // Look for state indicators
          const correctEl = document.querySelector('[data-state="correct"], .quiz-choice.correct, .right, [class*="correct"]:not([class*="incorrect"])');
          const wrongEl = document.querySelector('[data-state="wrong"], [data-state="incorrect"], .quiz-choice.wrong, [class*="wrong"], [class*="incorrect"]');
          if (correctEl) return 'correct-visible';
          if (wrongEl) return 'wrong-visible';
          // Fallback: feedback text
          const fb = document.querySelector('.quiz-feedback, .feedback, .explain');
          return fb ? `feedback-text(${fb.textContent.slice(0, 30)})` : 'no-feedback';
        });
        if (result === 'correct-visible') solveResults.correct++;
        else if (result === 'wrong-visible') solveResults.wrong++;
      }

      // Advance
      const advanced = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-action="next-q"], [onclick*="next"], button')]
          .find(b => /^.{0,3}(next|הבא|הבאה|→|>).{0,3}$/i.test(b.textContent.trim()));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (advanced) solveResults.advance++;
      await page.waitForTimeout(300);
    } catch (e) {
      solveResults.errors.push(`q${qIdx}: ${e.message.slice(0, 80)}`);
    }
  }
  log(repo.name, 'SOLVE_LOOP', '', solveResults);

  // ===== POST-SOLVE PERF =====
  const perfAfter = await page.evaluate(() => {
    const mem = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
    } : null;
    return {
      memMB: mem,
      resourceCount: performance.getEntriesByType('resource').length,
      longTasks: performance.getEntriesByType('longtask')?.length ?? 'unsupported',
    };
  });
  log(repo.name, 'PERF_AFTER', '', perfAfter);

  // Memory growth
  if (perf.memMB && perfAfter.memMB) {
    const growth = perfAfter.memMB.used - perf.memMB.used;
    log(repo.name, 'MEM_GROWTH', `${growth >= 0 ? '+' : ''}${growth}MB after 10 questions`);
  }

  // ===== NETWORK SUMMARY =====
  log(repo.name, 'NET_SLOW', `${slowRequests.length} requests >1s`, slowRequests.slice(0, 5));
  log(repo.name, 'NET_FAIL', `${failedRequests.length} failures`, failedRequests.slice(0, 5));

  // Final screenshot
  await page.screenshot({ path: `${SS_DIR}/${repo.name}__perf_02_after_solve.png` });

  await ctx.close();
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    console.log('Browser: system Chrome (headless)\n');
  } catch (e) {
    browser = await chromium.launch({ headless: true });
    console.log('Browser: bundled chromium (headless)\n');
  }

  for (const repo of REPOS) {
    try {
      await simulate(repo, browser);
    } catch (e) {
      log(repo.name, 'HARNESS_ERROR', e.message);
    }
  }
  await browser.close();

  // ===== FINAL REPORT =====
  console.log('\n\n=================== PERFORMANCE REPORT ===================');
  const byRepo = {};
  for (const f of findings) (byRepo[f.repo] ||= []).push(f);

  for (const [repo, list] of Object.entries(byRepo)) {
    const perf = list.find(f => f.type === 'PERF')?.data;
    const state = list.find(f => f.type === 'STATE')?.data;
    const solve = list.find(f => f.type === 'SOLVE_LOOP')?.data;
    const memGrowth = list.find(f => f.type === 'MEM_GROWTH')?.msg;
    const slow = list.find(f => f.type === 'NET_SLOW');
    const fails = list.find(f => f.type === 'NET_FAIL');
    const errors = list.filter(f => /ERROR/.test(f.type));

    console.log(`\n━━━ ${repo} ━━━`);
    console.log(`  Version: ${state?.appVersion ?? '?'} (qz=${state?.qzLen ?? '?'})`);
    console.log(`  Load: FCP=${perf?.fcp ?? '?'}ms, DCL=${perf?.domContentLoaded ?? '?'}ms, transfer=${(perf?.transferSize / 1024 | 0)}KB`);
    console.log(`  Memory: ${perf?.memMB?.used ?? '?'}MB initial → ${memGrowth ?? 'unknown'}`);
    console.log(`  Resources: ${perf?.resourceCount ?? '?'} initial`);
    console.log(`  Solved: picked=${solve?.picked}/10, checked=${solve?.checked}, correct=${solve?.correct}, wrong=${solve?.wrong}, advanced=${solve?.advance}`);
    if (solve?.pickTimes?.length) {
      const avgPick = (solve.pickTimes.reduce((a,b)=>a+b,0) / solve.pickTimes.length).toFixed(0);
      console.log(`  Avg pick latency: ${avgPick}ms`);
    }
    console.log(`  Slow requests (>1s): ${slow?.data?.length ?? 0}`);
    if (slow?.data?.length) for (const r of slow.data) console.log(`    ${r.t}ms ${r.status} ${r.url}`);
    console.log(`  Failed requests: ${fails?.data?.length ?? 0}`);
    if (fails?.data?.length) for (const r of fails.data) console.log(`    ${r.err} ${r.url}`);
    console.log(`  Console/Page errors: ${errors.length}`);
    for (const e of errors.slice(0, 3)) console.log(`    [${e.type}] ${e.msg.slice(0, 100)}`);
    if (solve?.errors?.length) {
      console.log(`  Solve-loop errors: ${solve.errors.length}`);
      for (const e of solve.errors.slice(0, 3)) console.log(`    ${e}`);
    }
  }

  fs.writeFileSync('C:/Users/User/perf_sim_findings.json', JSON.stringify(findings, null, 2));
  console.log(`\nFull log: C:/Users/User/perf_sim_findings.json`);
  console.log(`Screenshots: ${SS_DIR}/*__perf_*.png`);
}

main().catch(e => { console.error(e); process.exit(1); });
