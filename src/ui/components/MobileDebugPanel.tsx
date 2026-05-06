import { useEffect, useState } from 'react';
import { getCurrentUser, getLastLoginPasswordOrNull } from '@/auth/auth';
import { verifyCanary } from '@/storage/cloud';
import { isCanaryArmedThisSession } from '@/notes/save';

/**
 * Mobile breadcrumb panel — fixed-position debug surface for diagnosing
 * silent failures on devices where you can't open DevTools.
 *
 * Activation paths (any of these turns it on):
 *   - URL has `?debug=1`
 *   - localStorage['ward-helper.debugPanel'] === '1' (existing toggle in Settings)
 *
 * Module-level circular buffer of the last 30 events. Anything in the app can
 * call `pushBreadcrumb('login.start')` and the next render of the panel
 * picks it up — no React tree wiring required.
 *
 * Each entry shows: timestamp (HH:MM:SS) + event name + truncated payload.
 *
 * Why this exists: silent click failures on mobile (button does nothing,
 * no console available) cost the user 30+ minutes of "did the click even
 * register?" before they can describe the symptom precisely. With this
 * panel, the failure mode is immediately observable on the device.
 */

interface Crumb {
  t: number;
  ev: string;
  data?: string;
}

const BUFFER_SIZE = 30;
const buffer: Crumb[] = [];

/** Snip a payload to ~80 chars so it fits the cramped panel. */
function truncate(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > 80) return s.slice(0, 77) + '…';
  return s;
}

/**
 * Append an event to the breadcrumb buffer. Safe to call from any module —
 * there's no setup, no init, no React context.
 */
export function pushBreadcrumb(ev: string, data?: unknown): void {
  buffer.push({
    t: Date.now(),
    ev,
    ...(data !== undefined ? { data: truncate(data) } : {}),
  });
  if (buffer.length > BUFFER_SIZE) buffer.shift();
}

function isPanelEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const url = new URLSearchParams(window.location.search);
    if (url.get('debug') === '1') return true;
    return localStorage.getItem('ward-helper.debugPanel') === '1';
  } catch {
    return false;
  }
}

function fmt(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const COLLAPSED_KEY = 'ward-helper.debugPanelCollapsed';

function readCollapsed(): boolean {
  try {
    // Default to collapsed so the panel doesn't obstruct the view on first open.
    // The user explicitly expands it when they want to read events.
    return localStorage.getItem(COLLAPSED_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Render the panel. No-op if neither activation path is set. Polls the
 * buffer every 500ms via a render counter — simpler than wiring an
 * event-bus and the cost is negligible (component only mounts when
 * debug flag is on).
 *
 * Collapsed by default (just the title pill) so the panel doesn't obstruct
 * the page. Tap the title to expand. Preference persists in localStorage.
 */
export function MobileDebugPanel() {
  const [, tick] = useState(0);
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  const enabled = isPanelEnabled();

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }

  // On-demand canary diagnostic. Emits breadcrumbs into this same panel so
  // the user can see (a) whether a canary blob exists in the cloud for
  // their account (verify=='absent' → no), (b) whether the cached login
  // password decrypts it, (c) latency of the verify call. Past push
  // outcomes live in the same buffer as `canary.push.ok`/`canary.push.fail`
  // entries from the saveBoth + restore-backfill paths.
  async function runCanaryDiagnostic() {
    pushBreadcrumb('canary.diag.start');
    const pwd = getLastLoginPasswordOrNull();
    if (!pwd) {
      pushBreadcrumb('canary.diag.no-pwd');
      return;
    }
    const user = getCurrentUser();
    const t0 = Date.now();
    try {
      const result = await verifyCanary(pwd, user?.username ?? null);
      pushBreadcrumb('canary.verify', {
        result,
        ms: Date.now() - t0,
        trigger: 'diag',
      });
    } catch (e) {
      pushBreadcrumb('canary.diag.err', (e as Error).message ?? String(e));
    }
  }

  return (
    <div
      role="log"
      aria-label="debug breadcrumbs"
      style={{
        position: 'fixed',
        bottom: 4,
        left: 4,
        zIndex: 9999,
        maxWidth: collapsed ? 'auto' : 'calc(100vw - 8px)',
        maxHeight: collapsed ? 'auto' : '40vh',
        overflowY: collapsed ? 'visible' : 'auto',
        background: 'rgba(15,23,42,0.92)',
        color: '#e2e8f0',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.3,
        padding: collapsed ? '4px 8px' : 6,
        borderRadius: 6,
        border: '1px solid #334155',
        pointerEvents: 'auto',
        direction: 'ltr',
        textAlign: 'left',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'expand debug panel' : 'collapse debug panel'}
        style={{
          fontWeight: 700,
          marginBottom: collapsed ? 0 : 4,
          color: '#fbbf24',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          minHeight: 0,
        }}
      >
        🐞 debug ({buffer.length}/{BUFFER_SIZE}) {collapsed ? '▸ tap' : '▾'}
      </button>
      {!collapsed && (
        <>
          <button
            type="button"
            onClick={runCanaryDiagnostic}
            aria-label="run canary diagnostic"
            style={{
              marginLeft: 6,
              marginBottom: 4,
              color: '#a7f3d0',
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: 4,
              padding: '1px 6px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              minHeight: 0,
            }}
          >
            🔍 canary [{isCanaryArmedThisSession() ? 'armed' : 'disarmed'}]
          </button>
        </>
      )}
      {!collapsed && (
        <>
          {buffer.length === 0 && <div style={{ opacity: 0.6 }}>no events yet</div>}
          {buffer.map((c, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <span style={{ color: '#94a3b8' }}>{fmt(c.t)}</span>{' '}
              <span style={{ color: '#7dd3fc' }}>{c.ev}</span>
              {c.data && <span style={{ color: '#cbd5e1' }}> {c.data}</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
