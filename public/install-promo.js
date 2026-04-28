/**
 * Unified PWA install promo — shared across all six PWAs.
 *
 * Source of truth: C:\Users\User\repos\.shared\install-promo.js
 * Each consuming repo copies this file (byte-identical) to its own scripts dir
 * and imports/loads it on app boot.
 *
 * Behavior:
 *   - Captures `beforeinstallprompt` (Android/Chrome desktop), suppresses default
 *     mini-infobar, and exposes a JS API + dispatches a custom event.
 *   - Provides an unobtrusive bottom-sheet promo that shows ONCE per app install,
 *     after a usage threshold (default: 2 sessions, 60s engagement). User can
 *     dismiss permanently.
 *   - On iOS Safari (no beforeinstallprompt), renders an "Add to Home Screen"
 *     hint with the share+plus glyph instructions, gated by the same threshold.
 *
 * Public API (window.PWAInstall):
 *   isInstallable() : boolean
 *   isInstalled()   : boolean
 *   prompt()        : Promise<'accepted' | 'dismissed' | 'unavailable'>
 *   reset()         : clear local state (debug)
 *
 * Custom events on window:
 *   'pwa-install-available'   — installable now
 *   'pwa-install-accepted'    — user accepted prompt
 *   'pwa-install-dismissed'   — user dismissed prompt or sheet
 *
 * Storage:
 *   localStorage 'pwa-install-state' — { sessions, engagedSec, dismissedAt, installedAt }
 *
 * Per-app override (optional): set `window.PWA_INSTALL_CONFIG` BEFORE loading
 * this script:
 *   { appName: 'Pnimit Mega', minSessions: 3, minEngagedSec: 90,
 *     theme: 'auto'|'light'|'dark', position: 'bottom'|'top',
 *     copyHe: { headline, body, cta, dismiss }, copyEn: {...} }
 */

(function () {
  'use strict';

  // ---------- Config ----------
  const DEFAULTS = {
    appName: 'App',
    minSessions: 2,
    minEngagedSec: 60,
    theme: 'auto',
    position: 'bottom',
    locale: (navigator.language || 'en').toLowerCase().startsWith('he') ? 'he' : 'en',
    copyHe: {
      headline: 'התקן כאפליקציה',
      body: 'גישה מהירה ועבודה במצב לא מקוון.',
      cta: 'התקן',
      dismiss: 'לא עכשיו',
      iosHint: 'בספארי, לחץ על כפתור השיתוף ואז "הוסף למסך הבית".'
    },
    copyEn: {
      headline: 'Install as an app',
      body: 'Quick access and full offline use.',
      cta: 'Install',
      dismiss: 'Not now',
      iosHint: 'In Safari, tap the Share button, then "Add to Home Screen".'
    }
  };
  const CFG = Object.assign({}, DEFAULTS, window.PWA_INSTALL_CONFIG || {});
  const COPY = CFG.locale === 'he' ? CFG.copyHe : CFG.copyEn;
  const STORE_KEY = 'pwa-install-state';

  // ---------- State ----------
  const state = readState();
  let deferredPrompt = null;
  let sessionStart = Date.now();

  function readState() {
    try {
      return Object.assign(
        { sessions: 0, engagedSec: 0, dismissedAt: 0, installedAt: 0 },
        JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
      );
    } catch { return { sessions: 0, engagedSec: 0, dismissedAt: 0, installedAt: 0 }; }
  }
  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }

  // Bump session counter once per page load
  state.sessions += 1;
  writeState();

  // Track engaged time (visible + active)
  let lastTick = Date.now();
  function tickEngagement() {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      state.engagedSec += Math.min(5, (now - lastTick) / 1000);
      lastTick = now;
      writeState();
    } else {
      lastTick = Date.now();
    }
  }
  setInterval(tickEngagement, 5000);
  document.addEventListener('visibilitychange', tickEngagement);

  // ---------- Detection ----------
  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  if (isStandalone() && !state.installedAt) {
    state.installedAt = Date.now();
    writeState();
  }

  // ---------- Capture beforeinstallprompt ----------
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-install-available'));
    maybeShowSheet();
  });
  window.addEventListener('appinstalled', () => {
    state.installedAt = Date.now();
    writeState();
    deferredPrompt = null;
    hideSheet();
    window.dispatchEvent(new CustomEvent('pwa-install-accepted'));
  });

  // ---------- Bottom-sheet UI ----------
  let sheet = null;
  function buildSheet() {
    if (sheet) return sheet;
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', COPY.headline);
    wrap.dir = CFG.locale === 'he' ? 'rtl' : 'ltr';
    wrap.style.cssText = [
      'position:fixed', 'inset-inline:0',
      CFG.position === 'top' ? 'top:0' : 'bottom:0',
      'z-index:2147483640',
      'transform:translateY(' + (CFG.position === 'top' ? '-100%' : '100%') + ')',
      'transition:transform 320ms cubic-bezier(.2,.8,.3,1)',
      'padding:env(safe-area-inset-top, 0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'margin:12px', 'padding:16px 16px 14px',
      'background:var(--color-surface,#fff)', 'color:var(--color-fg,#111)',
      'border:1px solid var(--color-border,#e3e2dc)',
      'border-radius:var(--radius-lg,12px)',
      'box-shadow:var(--shadow-3,0 8px 24px rgba(0,0,0,.10))',
      'font-family:var(--font-body,system-ui,sans-serif)',
      'display:flex', 'flex-direction:column', 'gap:10px',
      'max-width:520px', 'margin-inline:auto'
    ].join(';');

    const h = document.createElement('div');
    h.textContent = COPY.headline;
    h.style.cssText = 'font-weight:700;font-size:1.05rem;line-height:1.2';

    const p = document.createElement('div');
    p.textContent = COPY.body;
    p.style.cssText = 'font-size:0.92rem;color:var(--color-fg-muted,#5b5a52);line-height:1.45';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px';

    const btnDismiss = document.createElement('button');
    btnDismiss.type = 'button';
    btnDismiss.textContent = COPY.dismiss;
    btnDismiss.style.cssText = btnStyle(false);
    btnDismiss.addEventListener('click', dismissForever);

    const btnAccept = document.createElement('button');
    btnAccept.type = 'button';
    btnAccept.textContent = COPY.cta;
    btnAccept.style.cssText = btnStyle(true);
    btnAccept.addEventListener('click', acceptPrompt);

    row.appendChild(btnDismiss);
    row.appendChild(btnAccept);

    card.appendChild(h); card.appendChild(p);
    if (isIOS() && !deferredPrompt) {
      const ios = document.createElement('div');
      ios.textContent = COPY.iosHint;
      ios.style.cssText = 'font-size:0.85rem;color:var(--color-fg-muted,#5b5a52);background:var(--color-surface-2,#f3f3ee);border-radius:var(--radius-md,8px);padding:8px 10px';
      card.appendChild(ios);
    }
    card.appendChild(row);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    sheet = wrap;
    return wrap;
  }
  function btnStyle(primary) {
    return [
      'min-height:44px', 'padding:10px 16px',
      'border-radius:var(--radius-md,8px)',
      'border:1px solid ' + (primary ? 'var(--color-accent,#5b3df5)' : 'var(--color-border,#e3e2dc)'),
      'background:' + (primary ? 'var(--color-accent,#5b3df5)' : 'transparent'),
      'color:' + (primary ? 'var(--color-accent-fg,#fff)' : 'var(--color-fg,#111)'),
      'font-weight:600', 'font-size:0.95rem',
      'cursor:pointer'
    ].join(';');
  }
  function showSheet() {
    const w = buildSheet();
    requestAnimationFrame(() => { w.style.transform = 'translateY(0)'; });
  }
  function hideSheet() {
    if (!sheet) return;
    sheet.style.transform = 'translateY(' + (CFG.position === 'top' ? '-100%' : '100%') + ')';
    setTimeout(() => { if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); sheet = null; }, 360);
  }
  function maybeShowSheet() {
    if (isStandalone()) return;
    if (state.installedAt) return;
    if (state.dismissedAt) return;
    if (state.sessions < CFG.minSessions) return;
    if (state.engagedSec < CFG.minEngagedSec) return;
    if (!deferredPrompt && !isIOS()) return;
    showSheet();
  }

  function dismissForever() {
    state.dismissedAt = Date.now();
    writeState();
    hideSheet();
    window.dispatchEvent(new CustomEvent('pwa-install-dismissed'));
  }
  async function acceptPrompt() {
    if (!deferredPrompt) {
      // iOS path: dismiss the sheet but don't lock-out (user has to follow OS instructions)
      hideSheet();
      return;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        window.dispatchEvent(new CustomEvent('pwa-install-accepted'));
      } else {
        dismissForever();
      }
    } catch {
      hideSheet();
    }
  }

  // Periodically reconsider showing (engagement may have crossed threshold)
  setInterval(maybeShowSheet, 30000);

  // ---------- Public API ----------
  window.PWAInstall = {
    isInstallable: () => Boolean(deferredPrompt) || (isIOS() && !isStandalone()),
    isInstalled:   () => Boolean(state.installedAt) || isStandalone(),
    prompt: async () => {
      if (!deferredPrompt && !isIOS()) return 'unavailable';
      if (isIOS() && !deferredPrompt) { showSheet(); return 'unavailable'; }
      try {
        await deferredPrompt.prompt();
        const c = await deferredPrompt.userChoice;
        deferredPrompt = null;
        return c && c.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch { return 'unavailable'; }
    },
    reset: () => { localStorage.removeItem(STORE_KEY); }
  };
})();
