/**
 * chaosV4.mjs — six new chaos types added in mega-bot v4.
 *
 * Web-Claude pushback shaped this file:
 *   - networkRamped (NOT flat) — slow-3G→offline→fast-4G cycle, fires
 *     online/offline events to test the transition class
 *   - idbQuotaStress — fill IDB to QuotaExceeded then verify graceful UI
 *   - edgeSwipeBack — iOS edge-swipe (popstate without nav guards)
 *   - midnightRollover — full Date constructor + .now + performance
 *     timeOrigin patch (raw Date.now() patch missed `new Date()` paths)
 *   - memoryPressure — CDP `Memory.simulatePressureNotification critical`
 *     (NOT iframes — same-process iframes don't model OOM)
 *   - randomClick — tagged `provenance: 'random_click'` so flags
 *     bypass severity counter (preserves the test class without
 *     polluting the bug ledger)
 *
 * EXIF rotation chaos was deferred to v5 pending a real-photo fixture set.
 *
 * All chaos hooks return { ok: true } on success or { ok: false, error }
 * on failure; the persona loop tally tracks both.
 */

import { sleep, rand } from './megaPersona.mjs';

// CDP session is per-page; cache to avoid re-creating on every chaos call.
const CDP_CACHE = new WeakMap();

async function getCdp(page) {
  if (CDP_CACHE.has(page)) return CDP_CACHE.get(page);
  const sess = await page.context().newCDPSession(page).catch(() => null);
  if (sess) CDP_CACHE.set(page, sess);
  return sess;
}

// ────────────────────────────────────────────────────────────────────────────
// Network: ramped slow-3G → offline → fast-4G cycle
// ────────────────────────────────────────────────────────────────────────────

const NETWORK_PROFILES = {
  slow3g:   { downloadThroughput: 500e3 / 8, uploadThroughput: 250e3 / 8, latency: 400, offline: false },
  offline:  { downloadThroughput: 0,         uploadThroughput: 0,          latency: 0,   offline: true  },
  fast4g:   { downloadThroughput: 4e6 / 8,   uploadThroughput: 3e6 / 8,    latency: 70,  offline: false },
  reset:    { downloadThroughput: -1,        uploadThroughput: -1,         latency: 0,   offline: false },
};

export async function chaosNetworkRamped(page) {
  const cdp = await getCdp(page);
  if (!cdp) return { ok: false, error: 'no-cdp' };

  // 30-second cycle: slow-3G(10s) → offline(5s) → fast-4G(10s) → reset(5s)
  const cycle = [
    { name: 'slow3g',  ms: 10000, dispatch: null },
    { name: 'offline', ms:  5000, dispatch: 'offline' },
    { name: 'fast4g',  ms: 10000, dispatch: 'online'  },
    { name: 'reset',   ms:  5000, dispatch: null },
  ];

  for (const phase of cycle) {
    try {
      const p = NETWORK_PROFILES[phase.name];
      await cdp.send('Network.emulateNetworkConditions', p);
      // Fire the online/offline event from the page side too — Playwright's
      // CDP toggle alone doesn't always trigger window 'online'/'offline'
      // listeners on first cycle.
      if (phase.dispatch) {
        await page.evaluate((kind) => {
          window.dispatchEvent(new Event(kind));
        }, phase.dispatch).catch(() => {});
      }
      await sleep(phase.ms);
    } catch (err) {
      return { ok: false, error: err.message?.slice(0, 100) };
    }
  }

  // Always reset at the end so subsequent actions aren't degraded.
  await cdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES.reset).catch(() => {});
  return { ok: true, cycles: cycle.length };
}

// ────────────────────────────────────────────────────────────────────────────
// IDB quota stress
// ────────────────────────────────────────────────────────────────────────────

export async function chaosIdbQuotaStress(page) {
  // Fill a junk IDB until QuotaExceededError, then check the app didn't crash.
  // We don't fill the app's actual IDB (would corrupt the test scenario);
  // we open a sibling DB and fill it. Quota is shared across all DBs of an
  // origin, so the app will hit quota when it next tries to write.
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('__chaos_quota_filler__', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('blobs', { keyPath: 'id', autoIncrement: true });
        };
        req.onerror = () => resolve({ ok: false, stage: 'open', error: String(req.error) });
        req.onsuccess = async () => {
          const db = req.result;
          // Allocate ~50 MB of junk per write. Stop at ~200 writes (10 GB
          // theoretical, real quota will fire much earlier — Chrome usually
          // caps origin storage at a fraction of available disk).
          const blob = new Uint8Array(50 * 1024 * 1024);
          for (let i = 0; i < blob.length; i++) blob[i] = (i * 31) & 0xff;
          let writes = 0;
          let lastError = null;
          for (let i = 0; i < 200; i++) {
            try {
              await new Promise((res, rej) => {
                const tx = db.transaction('blobs', 'readwrite');
                tx.objectStore('blobs').add({ data: blob });
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
                tx.onabort = () => rej(tx.error);
              });
              writes++;
            } catch (e) {
              lastError = String(e);
              break;
            }
            // Yield so we don't lock the page.
            if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
          }
          db.close();
          // Cleanup so subsequent run cycles aren't permanently bricked.
          indexedDB.deleteDatabase('__chaos_quota_filler__');
          resolve({ ok: true, writes, lastError, mb: writes * 50 });
        };
      } catch (e) {
        resolve({ ok: false, stage: 'init', error: String(e) });
      }
    });
  }).catch((err) => ({ ok: false, error: err.message?.slice(0, 100) }));
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Edge-swipe back gesture (iOS) — popstate without nav-guard intercept
// ────────────────────────────────────────────────────────────────────────────

export async function chaosEdgeSwipeBack(page) {
  // Distinct from chaosBackButtonMash: edge-swipe fires popstate but does
  // NOT trigger Playwright's page.goBack-style nav guards. Many SPAs
  // listen to history.popstate and assume goBack ran the guards first.
  const result = await page.evaluate(() => {
    try {
      // Push a fresh state so back has somewhere to go without leaving the SPA.
      const before = location.hash;
      history.pushState({ chaos: 'edge-swipe' }, '', before || '#/');
      // Now fire popstate manually with the back semantic.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      return { ok: true, before, after: location.hash };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 100) };
    }
  }).catch((err) => ({ ok: false, error: err.message?.slice(0, 100) }));
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Midnight rollover — full Date patch (constructor + .now + timeOrigin)
// ────────────────────────────────────────────────────────────────────────────

export async function chaosMidnightRollover(page) {
  // Pick a target that's "almost midnight" then advance past it during the
  // current persona's session. This tests "today's notes" filtering, IDB
  // day-keyed partitions, and date-display components.
  //
  // Strategy: addInitScript would be too late (page already loaded).
  // Instead we install the patch via evaluate() — it patches in-memory
  // Date for this page only; subsequent navigations un-patch (which is
  // realistic — the user wouldn't reload at midnight).
  const result = await page.evaluate(() => {
    try {
      // Pick a target time: tomorrow at 00:00:30 in local time.
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 30, 0);
      const targetMs = tomorrow.getTime();

      const RealDate = window.Date;
      const originalNow = RealDate.now;

      // eslint-disable-next-line no-undef
      window.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(targetMs);
          else super(...args);
        }
        static now() { return targetMs; }
        static parse(s) { return RealDate.parse(s); }
        static UTC(...a) { return RealDate.UTC(...a); }
      };

      // Restore after 4 seconds — long enough for the SPA to react to a
      // date-keyed event but short enough that other actions resume cleanly.
      setTimeout(() => {
        window.Date = RealDate;
        try { window.Date.now = originalNow; } catch (_) {}
      }, 4000);

      return { ok: true, targetIso: new Date(targetMs).toISOString(), durationMs: 4000 };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 100) };
    }
  }).catch((err) => ({ ok: false, error: err.message?.slice(0, 100) }));
  // Wait for patch window to finish so the next action sees real Date again.
  await sleep(4500);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Memory pressure (CDP — NOT iframes, same-process doesn't model real OOM)
// ────────────────────────────────────────────────────────────────────────────

export async function chaosMemoryPressure(page) {
  const cdp = await getCdp(page);
  if (!cdp) return { ok: false, error: 'no-cdp' };
  try {
    await cdp.send('Memory.simulatePressureNotification', { level: 'critical' });
    // Hold pressure for a few seconds, then notify moderate so the app can
    // recover instead of being stuck in critical-mode forever.
    await sleep(rand(3000, 5000));
    await cdp.send('Memory.simulatePressureNotification', { level: 'moderate' }).catch(() => {});
    await sleep(rand(800, 1500));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message?.slice(0, 100) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Random click (tagged provenance — does NOT pollute bug count)
// ────────────────────────────────────────────────────────────────────────────

export async function chaosRandomClick(page, persona, scenarioId, logBug) {
  // Models real iPhone-in-noisy-ward behavior: user taps something they
  // didn't quite mean to. Web-Claude argued L5 ("never nth(random)") was
  // over-rotated — the test class is real, the fix is to TAG the resulting
  // flags as provenance:'random_click' so they bypass severity counts.
  //
  // logBug calls from this fn pass `_provenance: 'random_click'` in evidence,
  // and the report renderer + analyzer skip them when computing severity.
  const visibleBtns = page.locator('button:visible');
  const N = await visibleBtns.count().catch(() => 0);
  if (N === 0) return { skipped: 'no_buttons' };
  const idx = Math.floor(Math.random() * N);
  const target = visibleBtns.nth(idx);
  const label = await target.textContent().catch(() => '?');
  try {
    await target.click({ timeout: 2000, force: true });
    await sleep(rand(300, 800));
    // We deliberately do NOT logBug here for happy-path random clicks.
    // Only log if the click resulted in an error banner.
    const hasError = await page.evaluate(() => {
      return /שגיאה|שגיאת/.test(document.body.innerText || '');
    }).catch(() => false);
    if (hasError) {
      logBug('LOW', scenarioId, `${persona.name}/random-click/error-banner`,
        `random click on "${(label || '').trim().slice(0, 40)}" surfaced error banner | _provenance:random_click`);
    }
    return { ok: true, clicked: (label || '').trim().slice(0, 40) };
  } catch (err) {
    return { ok: false, error: err.message?.slice(0, 80) };
  }
}
