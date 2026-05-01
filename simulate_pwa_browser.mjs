// Real browser simulation of medical PWAs using Playwright + Chromium.
// Captures console messages, page errors, network failures, runtime exceptions.
// Triggers the 5-tap-corner debug console (Geri/IM/FM feature) and captures its output.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPOS = [
  { name: 'Geriatrics',       root: 'C:/Users/User/repos/Geriatrics',        page: 'shlav-a-mega.html', port: 8101 },
  { name: 'InternalMedicine', root: 'C:/Users/User/repos/InternalMedicine/dist', page: 'pnimit-mega.html', port: 8102 },
  { name: 'FamilyMedicine',   root: 'C:/Users/User/repos/FamilyMedicine/dist',   page: 'mishpacha-mega.html', port: 8103 },
];

const findings = [];
function log(repo, type, msg) {
  findings.push({ repo, type, msg: String(msg).slice(0, 500) });
  console.log(`[${repo}] [${type}] ${String(msg).slice(0, 200)}`);
}

async function startServer(root, port) {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-m', 'http.server', String(port)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: false
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('Serving')) resolve(proc);
    });
    setTimeout(() => resolve(proc), 1500);
  });
}

async function simulate(repo, browser) {
  console.log(`\n=== ${repo.name} ===`);
  const server = await startServer(repo.root, repo.port);
  try {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },  // mobile-ish
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error') log(repo.name, 'CONSOLE.ERROR', msg.text());
      else if (t === 'warning') log(repo.name, 'CONSOLE.WARN', msg.text());
    });
    page.on('pageerror', (err) => log(repo.name, 'PAGE_ERROR', err.message));
    page.on('requestfailed', (req) => {
      const f = req.failure();
      // Filter out expected ones (favicon, manifest)
      if (req.url().includes('favicon') || req.url().includes('manifest.json')) return;
      log(repo.name, 'NET_FAIL', `${req.url()} — ${f ? f.errorText : 'unknown'}`);
    });

    // Intercept requests to rewrite Vite base paths (IM/FM dist hardcodes /InternalMedicine/ /FamilyMedicine/)
    const basePrefix = '/' + repo.name + '/';
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes(basePrefix)) {
        const newUrl = url.replace(basePrefix, '/');
        return route.continue({ url: newUrl });
      }
      route.continue();
    });

    const url = `http://localhost:${repo.port}/${repo.page}`;
    log(repo.name, 'INFO', `Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => log(repo.name, 'NAV_ERROR', e.message));
    await page.waitForTimeout(2000);  // give SPA time to render

    // Capture title + visible question count
    const title = await page.title();
    log(repo.name, 'TITLE', title);

    const versionExposed = await page.evaluate(() => {
      try {
        return {
          appVersion: window.APP_VERSION ?? 'undefined',
          hasG: typeof window.G !== 'undefined',
          qzLength: (window.QZ ?? window.G?.QZ ?? []).length,
          hasDebug: typeof window.__debug !== 'undefined',
          docTitle: document.title,
          bodyClasses: document.body.className,
        };
      } catch (e) { return { err: e.message }; }
    }).catch((e) => ({ err: e.message }));
    log(repo.name, 'WINDOW', JSON.stringify(versionExposed));

    // ====== Trigger 5-tap debug console ======
    if (versionExposed.hasDebug || repo.name === 'Geriatrics' || repo.name === 'FamilyMedicine' || repo.name === 'InternalMedicine') {
      log(repo.name, 'INFO', 'Attempting 5-tap top-right corner...');
      try {
        const vp = page.viewportSize();
        for (let i = 0; i < 5; i++) {
          await page.mouse.click(vp.width - 20, 20);
          await page.waitForTimeout(150);
        }
        await page.waitForTimeout(800);
        // Try common debug console selectors
        const debugFound = await page.evaluate(() => {
          const sels = ['#debug-panel', '#__debug-panel', '.debug-console', '[data-debug-panel]', '#__debug', '#debug-overlay'];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.offsetWidth > 0) return { sel: s, text: el.innerText.slice(0, 1000) };
          }
          // Fallback: any element with 'debug' that became visible
          const allDivs = [...document.querySelectorAll('div, section, dialog')].filter(d => /debug/i.test(d.id + ' ' + d.className));
          for (const el of allDivs) {
            if (el.offsetWidth > 0 && el.offsetHeight > 0) return { sel: el.tagName + (el.id ? '#'+el.id : ''), text: el.innerText.slice(0, 1000) };
          }
          return null;
        });
        if (debugFound) log(repo.name, 'DEBUG_PANEL_OPENED', `Selector: ${debugFound.sel} | Content: ${debugFound.text.slice(0, 300)}`);
        else log(repo.name, 'DEBUG_PANEL', 'No debug panel surfaced after 5 taps');

        // Also try the API directly
        const apiResult = await page.evaluate(() => {
          if (typeof window.__debug === 'undefined') return 'window.__debug undefined';
          try {
            return {
              hasReport: typeof window.__debug.report === 'function',
              hasShow: typeof window.__debug.show === 'function',
              hasBuffer: !!window.__debug.buffer,
              bufferLen: (window.__debug.buffer || []).length,
            };
          } catch (e) { return e.message; }
        });
        log(repo.name, 'DEBUG_API', JSON.stringify(apiResult));
      } catch (e) {
        log(repo.name, 'DEBUG_SIM_ERROR', e.message);
      }
    }

    // ====== Try to navigate the quiz ======
    try {
      // Common quiz tab selector
      const quizTabClicked = await page.evaluate(() => {
        // Try clicking the Quiz tab
        const tabs = [...document.querySelectorAll('[data-tab], .tab, button, a')]
          .filter(el => /quiz|מבחן|שאלות/i.test(el.textContent));
        if (tabs[0]) { tabs[0].click(); return tabs[0].textContent.slice(0, 50); }
        return null;
      });
      if (quizTabClicked) log(repo.name, 'INTERACT', `Clicked tab: ${quizTabClicked}`);
      await page.waitForTimeout(1000);

      // Count rendered question elements
      const qStats = await page.evaluate(() => ({
        questionEls: document.querySelectorAll('.q-stage, .quiz-question, .quiz-stage, [data-question]').length,
        choiceEls: document.querySelectorAll('.quiz-choice, .choice, [data-action="pick"]').length,
        buttons: document.querySelectorAll('button').length,
      }));
      log(repo.name, 'UI_STATS', JSON.stringify(qStats));
    } catch (e) {
      log(repo.name, 'INTERACT_ERROR', e.message);
    }

    // Take screenshot for evidence
    const ssDir = 'C:/Users/User/sim_screenshots';
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir);
    await page.screenshot({ path: `${ssDir}/${repo.name}.png` }).catch(()=>{});
    log(repo.name, 'INFO', `screenshot saved`);

    await ctx.close();
  } finally {
    try { server.kill('SIGKILL'); } catch {}
    // On Windows, sometimes need taskkill
    try { spawn('taskkill', ['/F', '/PID', String(server.pid)]); } catch {}
  }
}

async function main() {
  console.log('Launching chromium...');
  const browser = await chromium.launch({ headless: true });
  for (const repo of REPOS) {
    try {
      await simulate(repo, browser);
    } catch (e) {
      log(repo.name, 'TEST_HARNESS_ERROR', e.message);
    }
  }
  await browser.close();

  // Summary
  console.log('\n\n====================== SUMMARY ======================');
  const byRepo = {};
  for (const f of findings) (byRepo[f.repo] ||= []).push(f);
  for (const [repo, list] of Object.entries(byRepo)) {
    const errors = list.filter(f => /ERROR|FAIL/.test(f.type));
    const warns = list.filter(f => /WARN/.test(f.type));
    console.log(`\n${repo}: ${list.length} events (${errors.length} errors, ${warns.length} warnings)`);
    for (const f of errors.concat(warns)) console.log(`  [${f.type}] ${f.msg.slice(0,200)}`);
  }

  fs.writeFileSync('C:/Users/User/browser_sim_findings.json', JSON.stringify(findings, null, 2));
  console.log('\nFull log: C:/Users/User/browser_sim_findings.json');
  console.log('Screenshots: C:/Users/User/sim_screenshots/');
}

main().catch(e => { console.error(e); process.exit(1); });
