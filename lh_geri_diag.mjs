import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
const browser = await chromium.launch({ headless: true, args: ['--remote-debugging-port=9224', '--no-sandbox'] });
try {
  const r = await lighthouse('https://eiasash.github.io/Geriatrics/shlav-a-mega.html', {
    port: 9224, output: 'json', logLevel: 'error',
    onlyCategories: ['performance'],
    formFactor: 'mobile',
    throttling: { rttMs: 150, throughputKbps: 1638, cpuSlowdownMultiplier: 4 },
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
  });
  const a = r.lhr.audits;
  // LCP element
  const lcpEl = a['largest-contentful-paint-element'];
  if (lcpEl?.details?.items?.[0]?.node) console.log('LCP element:', JSON.stringify(lcpEl.details.items[0].node).slice(0, 400));
  // Render-blocking resources
  const block = a['render-blocking-resources'];
  if (block?.details?.items) console.log('Render-blocking:', JSON.stringify(block.details.items).slice(0, 800));
  // Network requests sorted by transfer time
  const net = a['network-requests'];
  if (net?.details?.items) {
    const big = net.details.items
      .filter(i => i.transferSize > 50000 || i.endTime - i.startTime > 500)
      .sort((a,b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))
      .slice(0, 8)
      .map(i => ({
        url: i.url.split('/').slice(-2).join('/'),
        size: Math.round(i.transferSize / 1024) + 'KB',
        time: Math.round(i.endTime - i.startTime) + 'ms',
        priority: i.priority,
      }));
    console.log('Top requests by time:', JSON.stringify(big, null, 2));
  }
  // Main-thread work
  const main = a['mainthread-work-breakdown'];
  if (main?.displayValue) console.log('Main-thread work:', main.displayValue);
  if (main?.details?.items) console.log('Main-thread breakdown:', JSON.stringify(main.details.items).slice(0, 600));
} finally {
  await browser.close();
}
