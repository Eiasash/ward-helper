import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';

const URL = 'https://eiasash.github.io/Geriatrics/shlav-a-mega.html?v=10.63.6';

const browser = await chromium.launch({
  headless: true,
  args: ['--remote-debugging-port=9226', '--no-sandbox'],
});
try {
  const r = await lighthouse(URL, {
    port: 9226,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance'],
    formFactor: 'mobile',
    throttling: { rttMs: 150, throughputKbps: 1638, cpuSlowdownMultiplier: 4 },
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
  });
  const a = r.lhr.audits;
  const c = r.lhr.categories;

  console.log('PRESET: mobile / Slow 4G simulated / 412x823 @ 1.75 DPR / 4x CPU');
  console.log('URL:   ', URL);
  console.log('SCORE: ', Math.round(c.performance.score * 100));
  console.log('METRICS:', JSON.stringify({
    FCP: a['first-contentful-paint'].displayValue,
    LCP: a['largest-contentful-paint'].displayValue,
    TBT: a['total-blocking-time'].displayValue,
    CLS: a['cumulative-layout-shift'].displayValue,
    SI:  a['speed-index'].displayValue,
    TTI: a['interactive'].displayValue,
  }, null, 2));

  // LCP element — confirms WHICH DOM node Lighthouse pinned
  const lcpEl = a['largest-contentful-paint-element'];
  if (lcpEl?.details?.items?.[0]?.node) {
    const node = lcpEl.details.items[0].node;
    console.log('LCP element:');
    console.log('  selector:', node.selector);
    console.log('  snippet :', (node.snippet || '').slice(0, 200));
    console.log('  text    :', (node.nodeLabel || '').slice(0, 200));
  }

  // LCP subparts — answers "where did the time go"
  const lcpSubs = a['lcp-lazy-loaded'] || a['largest-contentful-paint-element'];
  const phases = a['largest-contentful-paint']?.details;
  if (phases) console.log('LCP subparts:', JSON.stringify(phases, null, 2).slice(0, 600));
} finally {
  await browser.close();
}
