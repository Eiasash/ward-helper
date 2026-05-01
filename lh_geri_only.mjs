import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
const browser = await chromium.launch({ headless: true, args: ['--remote-debugging-port=9223', '--no-sandbox'] });
try {
  const r = await lighthouse('https://eiasash.github.io/Geriatrics/shlav-a-mega.html', {
    port: 9223,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility'],
    formFactor: 'mobile',
    throttling: { rttMs: 150, throughputKbps: 1638, cpuSlowdownMultiplier: 4 },
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
  });
  const c = r.lhr.categories;
  const a = r.lhr.audits;
  console.log('SCORES:', JSON.stringify({
    perf: Math.round(c.performance.score * 100),
    a11y: Math.round(c.accessibility.score * 100),
  }));
  console.log('METRICS:', JSON.stringify({
    FCP: a['first-contentful-paint'].displayValue,
    LCP: a['largest-contentful-paint'].displayValue,
    TBT: a['total-blocking-time'].displayValue,
    CLS: a['cumulative-layout-shift'].displayValue,
    SI:  a['speed-index'].displayValue,
    TTI: a['interactive'].displayValue,
  }));
} finally {
  await browser.close();
}
