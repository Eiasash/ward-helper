// Comprehensive PWA harness: 100Q stress + 3G throttle + offline mode + Lighthouse
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import fs from 'node:fs';

const REPOS = [
  { name: 'Geriatrics',       url: 'https://eiasash.github.io/Geriatrics/shlav-a-mega.html' },
  { name: 'InternalMedicine', url: 'https://eiasash.github.io/InternalMedicine/pnimit-mega.html' },
  { name: 'FamilyMedicine',   url: 'https://eiasash.github.io/FamilyMedicine/mishpacha-mega.html' },
];

const findings = [];
const log = (repo, type, msg, data) => {
  findings.push({ repo, test: type.split('.')[0], type, msg, data });
  const d = data ? ` ${JSON.stringify(data).slice(0, 180)}` : '';
  console.log(`[${repo}] [${type}] ${msg}${d}`);
};

const SS_DIR = 'C:/Users/User/sim_screenshots';
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR);

// ================== TEST 1: 100Q STRESS + MEMORY ==================
async function stressTest(repo, browser) {
  console.log(`\n┌─ ${repo.name} :: 100Q STRESS ─`);
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log(repo.name, 'STRESS.PAGE_ERROR', err.message));

  await page.goto(repo.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click Quiz tab
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('[data-tab], .tab, button, a')]
      .find(el => /^.{0,5}(Quiz|מבחן|שאלות).{0,5}$/i.test(el.textContent.trim()));
    t?.click();
  });
  await page.waitForTimeout(1000);

  const memSamples = [];
  const sample = async (label) => {
    const m = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null);
    memSamples.push({ label, mb: m, t: Date.now() });
    return m;
  };

  await sample('start');
  let solved = 0;
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => {
      const choices = document.querySelectorAll('[data-action="pick"], [onclick*="pick("], .quiz-choice, [data-i]');
      if (choices.length < 2) return false;
      choices[Math.floor(Math.random() * Math.min(choices.length, 4))].click();
      return true;
    });
    if (!ok) continue;
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-action="check-answer"], [onclick*="check"], button')]
        .find(b => /^.{0,3}(check|בדוק|הצג).{0,5}$/i.test(b.textContent.trim()));
      btn?.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-action="next-q"], [onclick*="next"], button')]
        .find(b => /^.{0,3}(next|הבא|→).{0,3}$/i.test(b.textContent.trim()));
      btn?.click();
    });
    await page.waitForTimeout(80);
    solved++;
    if (i === 25 || i === 50 || i === 75) await sample(`q${i}`);
  }
  await sample('end');

  const start = memSamples[0]?.mb ?? 0;
  const end = memSamples[memSamples.length - 1]?.mb ?? 0;
  const peak = Math.max(...memSamples.map(s => s.mb || 0));
  log(repo.name, 'STRESS.RESULT', `solved=${solved}/100, mem ${start}MB→${end}MB (peak ${peak}MB, growth ${end - start}MB)`, { samples: memSamples });

  await ctx.close();
}

// ================== TEST 2: 3G THROTTLE COLD LOAD ==================
async function throttleTest(repo, browser) {
  console.log(`\n┌─ ${repo.name} :: 3G THROTTLE ─`);
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  // Slow 3G profile
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (400 * 1000) / 8,  // 400 Kbps in bytes/sec
    uploadThroughput: (400 * 1000) / 8,
    latency: 400,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  page.on('pageerror', (err) => log(repo.name, 'THROTTLE.PAGE_ERROR', err.message));
  const t0 = Date.now();
  let fcp, lcp;
  page.on('console', () => {});

  await page.goto(repo.url, { waitUntil: 'load', timeout: 90000 }).catch(e => log(repo.name, 'THROTTLE.NAV_ERROR', e.message));
  const loadT = Date.now() - t0;

  await page.waitForTimeout(2000);
  const perf = await page.evaluate(() => {
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find(p => p.name === 'first-contentful-paint')?.startTime;
    const nav = performance.getEntriesByType('navigation')[0];
    return { fcp: fcp ? Math.round(fcp) : null, dcl: nav ? nav.domContentLoadedEventEnd | 0 : null };
  });
  log(repo.name, 'THROTTLE.RESULT', `slow-3G + 4× CPU: load=${loadT}ms, FCP=${perf.fcp}ms, DCL=${perf.dcl}ms`);
  await ctx.close();
}

// ================== TEST 3: OFFLINE MODE ==================
async function offlineTest(repo, browser) {
  console.log(`\n┌─ ${repo.name} :: OFFLINE ─`);
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();

  // First load (online) — let SW install
  await page.goto(repo.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);  // give SW time to register + cache

  const swState = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return 'unsupported';
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length === 0 ? 'no-registrations' : regs.map(r => ({
      scope: r.scope, active: !!r.active, state: r.active?.state
    }));
  });
  log(repo.name, 'OFFLINE.SW_REG', '', swState);

  // Go offline + reload
  await ctx.setOffline(true);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  let offlineLoaded = false;
  try {
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    offlineLoaded = true;
  } catch (e) {
    log(repo.name, 'OFFLINE.RELOAD_FAIL', e.message);
  }
  const offlineMs = Date.now() - t0;

  if (offlineLoaded) {
    await page.waitForTimeout(2000);  // give SW-cached data time to load
    const offlineState = await page.evaluate(() => ({
      title: document.title,
      bodyLen: document.body.innerText.length,
      bodySample: document.body.innerText.slice(0, 200),
      qzLen: (window.QZ ?? window.G?.QZ ?? []).length,
      hasFetchErrors: !!document.querySelector('.error, [data-error]'),
    }));
    log(repo.name, 'OFFLINE.RESULT', `loaded=${offlineMs}ms, title="${offlineState.title}", bodyLen=${offlineState.bodyLen}, qz=${offlineState.qzLen}, fetchErrors=${offlineState.hasFetchErrors}`, { sample: offlineState.bodySample });
  }

  await ctx.setOffline(false);
  await ctx.close();
}

// ================== TEST 4: LIGHTHOUSE ==================
async function lighthouseTest(repo) {
  console.log(`\n┌─ ${repo.name} :: LIGHTHOUSE ─`);
  // Lighthouse needs its own browser instance via remote debugging
  const lhBrowser = await chromium.launch({
    headless: true,
    args: ['--remote-debugging-port=9222', '--no-sandbox'],
  });
  try {
    const result = await lighthouse(repo.url, {
      port: 9222,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: 'mobile',
      throttling: {
        rttMs: 150,
        throughputKbps: 1638,  // typical mobile
        cpuSlowdownMultiplier: 4,
      },
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
      },
    });
    if (!result?.lhr) {
      log(repo.name, 'LH.ERROR', 'no result');
      return;
    }
    const cats = result.lhr.categories;
    const audits = result.lhr.audits;
    log(repo.name, 'LH.SCORES', '', {
      perf: Math.round((cats.performance?.score ?? 0) * 100),
      a11y: Math.round((cats.accessibility?.score ?? 0) * 100),
      bp:   Math.round((cats['best-practices']?.score ?? 0) * 100),
      pwa:  cats.pwa ? Math.round(cats.pwa.score * 100) : 'n/a',
    });
    log(repo.name, 'LH.METRICS', '', {
      FCP: audits['first-contentful-paint']?.displayValue,
      LCP: audits['largest-contentful-paint']?.displayValue,
      TBT: audits['total-blocking-time']?.displayValue,
      CLS: audits['cumulative-layout-shift']?.displayValue,
      SI:  audits['speed-index']?.displayValue,
      TTI: audits['interactive']?.displayValue,
    });
    // Top opportunities
    const opps = Object.values(audits)
      .filter(a => a.details?.type === 'opportunity' && a.numericValue > 50)
      .sort((a, b) => b.numericValue - a.numericValue)
      .slice(0, 5)
      .map(a => `${a.title} (${a.displayValue || ''})`);
    if (opps.length) log(repo.name, 'LH.OPPORTUNITIES', '', opps);
    // A11y failures
    const a11yFails = Object.values(audits)
      .filter(a => a.scoreDisplayMode !== 'notApplicable' && a.score === 0 && a.id.match(/^a11y-|^aria|^color-|^image-|^heading-|^button-|^label/i))
      .slice(0, 5)
      .map(a => a.title);
    if (a11yFails.length) log(repo.name, 'LH.A11Y_FAILS', '', a11yFails);
  } catch (e) {
    log(repo.name, 'LH.ERROR', e.message);
  } finally {
    await lhBrowser.close();
  }
}

// ================== RUNNER ==================
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));

  for (const repo of REPOS) {
    console.log(`\n╔═══════════════════════════════════════════════╗`);
    console.log(`║  ${repo.name.padEnd(45)}║`);
    console.log(`╚═══════════════════════════════════════════════╝`);
    try { await stressTest(repo, browser); } catch (e) { log(repo.name, 'STRESS.ERROR', e.message); }
    try { await throttleTest(repo, browser); } catch (e) { log(repo.name, 'THROTTLE.ERROR', e.message); }
    try { await offlineTest(repo, browser); } catch (e) { log(repo.name, 'OFFLINE.ERROR', e.message); }
  }
  await browser.close();

  // Lighthouse separately (needs its own browser per repo)
  for (const repo of REPOS) {
    try { await lighthouseTest(repo); } catch (e) { log(repo.name, 'LH.ERROR', e.message); }
  }

  // ===== FINAL REPORT =====
  console.log('\n\n╔══════════════════ FINAL REPORT ══════════════════╗');
  const byRepo = {};
  for (const f of findings) (byRepo[f.repo] ||= []).push(f);

  for (const [repo, list] of Object.entries(byRepo)) {
    console.log(`\n━━━ ${repo} ━━━`);
    const stress = list.find(f => f.type === 'STRESS.RESULT');
    const throttle = list.find(f => f.type === 'THROTTLE.RESULT');
    const offline = list.find(f => f.type === 'OFFLINE.RESULT');
    const swReg = list.find(f => f.type === 'OFFLINE.SW_REG');
    const lhScores = list.find(f => f.type === 'LH.SCORES');
    const lhMetrics = list.find(f => f.type === 'LH.METRICS');
    const lhOpps = list.find(f => f.type === 'LH.OPPORTUNITIES');
    const lhA11y = list.find(f => f.type === 'LH.A11Y_FAILS');
    const errs = list.filter(f => /ERROR/.test(f.type));

    console.log(`  STRESS (100Q):  ${stress?.msg ?? 'failed'}`);
    console.log(`  3G+4×CPU:       ${throttle?.msg ?? 'failed'}`);
    console.log(`  OFFLINE:        ${offline?.msg ?? 'failed'} | SW: ${JSON.stringify(swReg?.data ?? '?').slice(0,100)}`);
    console.log(`  LH SCORES:      ${JSON.stringify(lhScores?.data ?? '?')}`);
    console.log(`  LH METRICS:     ${JSON.stringify(lhMetrics?.data ?? '?')}`);
    if (lhOpps?.data?.length) {
      console.log(`  LH OPPORTUNITIES:`);
      for (const o of lhOpps.data) console.log(`    - ${o}`);
    }
    if (lhA11y?.data?.length) {
      console.log(`  LH A11Y FAILS:`);
      for (const a of lhA11y.data) console.log(`    - ${a}`);
    }
    if (errs.length) {
      console.log(`  ERRORS (${errs.length}):`);
      for (const e of errs.slice(0, 3)) console.log(`    [${e.type}] ${e.msg.slice(0, 100)}`);
    }
  }

  fs.writeFileSync('C:/Users/User/full_sim_findings.json', JSON.stringify(findings, null, 2));
  console.log(`\nFull log: C:/Users/User/full_sim_findings.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
