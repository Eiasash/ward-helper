/**
 * In-app error console for ward-helper — PHI-scrubbed, copy-out, crash-survivable.
 *
 * Mirrors the sibling study apps' debug console (Geri / IM / FM `src/debug/console.js`)
 * in trigger gesture (5-tap top-right) and report format, with two ward-helper-specific
 * differences driven by PHI:
 *
 *   1. PHI scrub at CAPTURE — every error message is scrubbed before it enters the buffer,
 *      so raw patient data never sits in memory. Digit runs >=4 (teudat-zehut / MRN / phone /
 *      dates / large labs) -> [#]; quoted input echoes -> "[redacted]"; any Hebrew run
 *      (names, clinical prose) -> [he]. Stacks are kept verbatim (file/line/function are safe).
 *   2. Minimal capture surface — only window 'error', 'unhandledrejection', and console.error.
 *      Deliberately NOT console.log/info, fetch, or click capture (which the study siblings do):
 *      those streams carry far more PHI in a patient-data app for little error-debugging value.
 *      console.error is what catches React-error-boundary-swallowed render errors (React logs
 *      caught render errors there; they never reach window.onerror).
 *
 * In-memory only — NEVER persisted, NEVER sent anywhere. The panel + trigger attach to
 * document.body (outside the React tree) so they survive a full render crash. The "Copy
 * report" button writes to the clipboard on an explicit user gesture; the panel shows a
 * "PHI-scrubbed — review before sharing" banner as the residual-risk backstop (an unquoted
 * Latin-script name echo can survive the scrub).
 *
 * LOAD ORDER: imported FIRST in main.tsx so the hooks are live before any app code runs.
 */

declare const __APP_VERSION__: string;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const APP_NAME = 'ward-helper';
const MAX_ERRORS = 50;

export interface ErrEntry {
  t: number;
  type: string;
  message: string;
  stack: string;
}

/**
 * PHI scrub — exported for tests. Redacts the three highest-risk PHI shapes while keeping
 * English error text readable. Stacks are NOT passed through here (kept verbatim by callers).
 */
export function scrubPhi(input: unknown): string {
  const s = input == null ? '' : String(input);
  return s
    .replace(/\d{4,}/g, '[#]') // teudat-zehut / MRN / phone / dates / large labs
    .replace(/"[^"]{0,400}"/g, '"[redacted]"') // quoted input echo
    .replace(/'[^']{0,400}'/g, "'[redacted]'")
    .replace(/[֐-׿]+(?:[\s.,:;()/\-]+[֐-׿]+)*/g, '[he]'); // any Hebrew run
}

const buf: ErrEntry[] = [];

/**
 * Keep only real stack frames, dropping the leading "Error: <message>" header — that header
 * echoes the RAW (unscrubbed) message and is a PHI leak (the message itself is scrubbed and
 * stored separately). Frames (`at fn (file:line:col)`) carry no PHI, so they're kept verbatim,
 * preserving line/col for debugging.
 */
function cleanStack(stack?: string | null): string {
  if (!stack) return '';
  const lines = String(stack).split('\n');
  const start = lines.findIndex((l) => /^\s*at\s/.test(l) || /@.+:\d+/.test(l));
  return (start >= 0 ? lines.slice(start) : []).slice(0, 6).join('\n');
}

function add(type: string, message: unknown, stack?: string | null): void {
  try {
    const st = cleanStack(stack);
    buf.push({ t: Date.now(), type, message: scrubPhi(message), stack: st });
    if (buf.length > MAX_ERRORS) buf.shift();
    if (panel && panel.style.display !== 'none') render();
  } catch {
    /* the error console must never throw */
  }
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (a && typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

function firstStack(args: unknown[]): string | null {
  const e = args.find((a) => a instanceof Error) as Error | undefined;
  return e ? e.stack ?? null : null;
}

function report(): string {
  const head = [
    '=== DEBUG REPORT ===',
    `App: ${APP_NAME} v${APP_VERSION}`,
    `URL: ${scrubPhi(location.href)}`,
    `UA: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
    '⚠ PHI-scrubbed — review before sharing',
    `Entries: ${buf.length}`,
    '',
    `=== ERRORS (${buf.length}, last ${MAX_ERRORS}) ===`,
  ];
  const body = buf.length
    ? buf.map(
        (e, i) =>
          `#${i + 1} [${new Date(e.t).toISOString().slice(11, 19)}] ${e.type}: ${e.message}` +
          (e.stack ? `\n  ${e.stack.replace(/\n/g, '\n  ')}` : ''),
      )
    : ['(no errors captured)'];
  return head.concat(body, ['', '=== END REPORT ===']).join('\n');
}

// ---------- hooks ----------

function installHooks(): void {
  const origError = console.error.bind(console);

  window.addEventListener(
    'error',
    (e: ErrorEvent) => {
      const err = e.error as Error | undefined;
      let msg = (err && err.message) || e.message || 'error';
      if (!err && e.filename) msg += ` @ ${e.filename}:${e.lineno}:${e.colno}`;
      add('error', msg, err && err.stack);
    },
    true,
  );

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown;
    const msg = r instanceof Error ? r.message : r == null ? 'unhandledrejection' : String(r);
    add('promise', msg, r instanceof Error ? r.stack : null);
  });

  // Passthrough wrap — catches React-error-boundary render errors, preserves native logging.
  console.error = (...args: unknown[]): void => {
    try {
      add('console.error', stringifyArgs(args), firstStack(args));
    } catch {
      /* never throw from the wrap */
    }
    origError(...args);
  };
}

// ---------- panel (document.body — survives a React render crash) ----------

let panel: HTMLDivElement | null = null;
let pre: HTMLPreElement | null = null;

function style(el: HTMLElement, s: Record<string, string>): void {
  Object.assign(el.style, s);
}

function mkBtn(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  style(b, {
    font: 'inherit',
    padding: '6px 12px',
    minHeight: '34px',
    background: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid #475569',
    borderRadius: '8px',
    cursor: 'pointer',
  });
  return b;
}

function flash(btn: HTMLButtonElement, msg: string): void {
  btn.textContent = msg;
  setTimeout(() => {
    btn.textContent = '📋 Copy';
  }, 2000);
}

function doCopy(btn: HTMLButtonElement): void {
  const txt = report();
  const ok = (): void => flash(btn, '✓ Copied');
  const fail = (): void => {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) {
        ok();
        return;
      }
    } catch {
      /* fall through to prompt */
    }
    // iOS PWA webview blocks clipboard outside a user gesture — prompt is the manual path.
    try {
      window.prompt('Copy the report:', txt);
      ok();
    } catch {
      flash(btn, '✗ Copy failed');
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(ok, fail);
  } else {
    fail();
  }
}

function buildPanel(): void {
  panel = document.createElement('div');
  panel.id = '__wh_err_panel';
  panel.setAttribute('role', 'dialog');
  style(panel, {
    position: 'fixed',
    inset: '8px',
    zIndex: '2147483647',
    display: 'none',
    direction: 'ltr',
    textAlign: 'left',
    background: '#0b1020',
    color: '#e2e8f0',
    font: '12px/1.5 ui-monospace,Menlo,Consolas,monospace',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '10px',
    overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,.5)',
  });

  const bar = document.createElement('div');
  style(bar, { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' });
  const title = document.createElement('strong');
  title.textContent = `🐞 ${APP_NAME} errors`;
  style(title, { marginInlineEnd: 'auto' });
  const banner = document.createElement('span');
  banner.textContent = '⚠ PHI-scrubbed — review before sharing';
  style(banner, { color: '#fbbf24', fontSize: '11px' });

  const copyBtn = mkBtn('📋 Copy');
  const clearBtn = mkBtn('🗑 Clear');
  const closeBtn = mkBtn('✕');
  bar.append(title, banner, copyBtn, clearBtn, closeBtn);

  pre = document.createElement('pre');
  style(pre, { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0', userSelect: 'text' });

  panel.append(bar, pre);
  document.body.appendChild(panel);

  copyBtn.onclick = () => doCopy(copyBtn);
  clearBtn.onclick = () => {
    buf.length = 0;
    render();
  };
  closeBtn.onclick = () => {
    if (panel) panel.style.display = 'none';
  };
}

function render(): void {
  if (pre) pre.textContent = report();
}

function show(): void {
  if (!panel) buildPanel();
  render();
  if (panel) panel.style.display = '';
}

// ---------- trigger: passive 5-tap top-right (non-blocking) + Ctrl+Shift+D ----------

let taps: number[] = [];

function inCorner(x: number, y: number): boolean {
  return x > window.innerWidth * 0.7 && y < window.innerHeight * 0.15;
}

function registerTap(x: number, y: number): void {
  if (!inCorner(x, y)) return;
  const n = Date.now();
  taps = taps.filter((z) => n - z < 3000);
  taps.push(n);
  if (taps.length >= 5) {
    taps = [];
    show();
  }
}

function installTrigger(): void {
  // Passive coordinate listeners — no inserted element, so nothing is blocked.
  document.addEventListener('click', (e) => registerTap(e.clientX, e.clientY), true);
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (t) registerTap(t.clientX, t.clientY);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        show();
      }
    },
    true,
  );
}

// ---------- init ----------

declare global {
  interface Window {
    __debug?: { show: () => void; report: () => string; buffer: ErrEntry[]; clear: () => void };
  }
}

let installed = false;

/** Install hooks + trigger. Idempotent. Called automatically on import in the browser. */
export function installErrorConsole(): void {
  if (installed || typeof window === 'undefined' || window.__debug) return;
  installed = true;
  installHooks();
  if (typeof document !== 'undefined') installTrigger();
  window.__debug = {
    show,
    report,
    buffer: buf,
    clear: () => {
      buf.length = 0;
      render();
    },
  };
}

// Auto-install on import so boot/render errors are captured (load-order: imported first in
// main.tsx). Skipped under vitest (NODE_ENV=test) — tests call installErrorConsole() explicitly.
const IS_TEST = typeof process !== 'undefined' && !!process.env && process.env.NODE_ENV === 'test';
if (typeof window !== 'undefined' && !IS_TEST) installErrorConsole();
