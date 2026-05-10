/**
 * attachDiagnostics(page, scenarioId, logBug) — 4 bug-detection hooks
 * that catch failure modes vitest can't see.
 *
 * Hooks attached:
 *   1. console.warning  — render-detach often warns, not errors.
 *      See memory project_render_detach_antipattern.md.
 *   2. page.crash       — separate from pageerror; catches worker / renderer death.
 *   3. unhandledrejection — async handler stale-closure bugs (setAuthSession race).
 *      See memory feedback_react_setauthsession_unmount_race.md.
 *   4. securitypolicyviolation — CSP hash drift after CACHE_VERSION bump.
 *      See memory feedback_csp_inline_script_hash_drift.md.
 *
 * The CSP listener and unhandledrejection are injected via addInitScript
 * so they wire up before the SPA mounts, then forward to console.error
 * with a known prefix the Node-side picks up via console listener.
 *
 * Usage:
 *   const diag = attachDiagnostics(page, scenario.scenario_id, logBug);
 *   ...
 *   diag.summary() → { warnings, csp, rejections, slow }
 */

const SLOW_ACK_BUDGET_MS = 5000;

export function attachDiagnostics(page, scenarioId, logBug) {
  const counts = { warning: 0, crash: 0, rejection: 0, csp: 0, slowAcks: 0 };
  const samples = { warnings: [], crashes: [], rejections: [], csps: [], slow: [] };

  // Hook 1: console warning (in addition to existing error capture)
  page.on('console', (msg) => {
    if (msg.type() === 'warning') {
      counts.warning++;
      const t = msg.text();
      if (samples.warnings.length < 5) samples.warnings.push(t.slice(0, 200));
      // The injected init scripts forward CSP + rejections through console.error
      // with prefixes — but if any leaked through as warning, capture them here.
      if (/__CSP__/.test(t)) {
        counts.csp++;
        samples.csps.push(t.slice(0, 240));
        logBug('HIGH', scenarioId, 'csp-violation', `CSP blocked: ${t.replace('__CSP__:', '').slice(0, 200)}`);
      }
    }
  });

  // Hook 1b: error console messages forwarded from init scripts
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (t.startsWith('__CSP__:')) {
      counts.csp++;
      samples.csps.push(t.slice(0, 240));
      logBug('HIGH', scenarioId, 'csp-violation', `CSP blocked: ${t.replace('__CSP__:', '').slice(0, 200)}`);
    } else if (t.startsWith('__UNHANDLED__:')) {
      counts.rejection++;
      samples.rejections.push(t.slice(0, 240));
      logBug('HIGH', scenarioId, 'unhandled-rejection', t.replace('__UNHANDLED__:', '').slice(0, 200));
    }
  });

  // Hook 2: renderer crash
  page.on('crash', () => {
    counts.crash++;
    samples.crashes.push('renderer crash');
    logBug('CRITICAL', scenarioId, 'page-crash', 'renderer crashed (page.on crash event)');
  });

  // Inject the unhandledrejection + CSP listeners early.
  page
    .addInitScript(() => {
      // eslint-disable-next-line no-undef
      window.addEventListener('unhandledrejection', (ev) => {
        const reason = ev?.reason;
        // Capture richer info: message, stack head, type, and a JSON tail.
        let msg = '';
        if (reason instanceof Error) {
          msg = `${reason.name}: ${reason.message}`;
          if (reason.stack) {
            const top = reason.stack.split('\n').slice(0, 3).join(' | ');
            msg += ` @ ${top}`;
          }
        } else if (reason === undefined) {
          msg = 'reason=undefined (Promise.reject() called with no value or void return)';
        } else if (reason === null) {
          msg = 'reason=null';
        } else if (typeof reason === 'object') {
          try { msg = `obj: ${JSON.stringify(reason).slice(0, 200)}`; }
          catch (_) { msg = `obj: [unserializable] keys=${Object.keys(reason).join(',')}`; }
        } else {
          msg = `${typeof reason}: ${String(reason).slice(0, 200)}`;
        }
        // eslint-disable-next-line no-console
        console.error(`__UNHANDLED__: ${msg}`);
      });
      // eslint-disable-next-line no-undef
      window.addEventListener('securitypolicyviolation', (ev) => {
        // eslint-disable-next-line no-console
        console.error(
          `__CSP__: ${ev.violatedDirective || 'unknown'} blocked ${ev.blockedURI || ev.sourceFile || 'inline'}`,
        );
      });
    })
    .catch(() => {});

  return {
    counts,
    samples,
    /**
     * markAck(actionLabel, t0) — call after waiting for a banner / state change.
     * If the wait exceeded SLOW_ACK_BUDGET_MS, log a slow-ack bug.
     */
    markAck(actionLabel, t0) {
      const dt = Date.now() - t0;
      if (dt > SLOW_ACK_BUDGET_MS) {
        counts.slowAcks++;
        samples.slow.push({ action: actionLabel, dt });
        logBug('LOW', scenarioId, 'slow-ack', `${actionLabel} took ${dt}ms (>${SLOW_ACK_BUDGET_MS}ms budget)`);
      }
    },
    summary() {
      return { ...counts, samples };
    },
  };
}
