import { useEffect, useState } from 'react';
import { snapshot, clear, type Snapshot } from '@/agent/debugLog';
import { getDbStats, type DbStats } from '@/storage/indexed';
import { getSupabaseConfig } from '@/storage/cloud';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

function humanizeBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

function entryJson(entry: Snapshot['extract']): string {
  if (!entry) return '—';
  return JSON.stringify(entry, null, 2);
}

export function DebugPanel() {
  const [snap, setSnap] = useState<Snapshot>(() => snapshot());
  const [stats, setStats] = useState<DbStats | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'err'>('idle');

  const cfg = (() => {
    try {
      return getSupabaseConfig();
    } catch {
      return { url: '(unconfigured)', keyPrefix: '' };
    }
  })();

  useEffect(() => {
    let cancelled = false;
    getDbStats().then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refresh() {
    setSnap(snapshot());
    getDbStats().then(setStats);
  }

  async function onCopy() {
    const blob = buildSnapshotText({ snap, stats, cfg });
    try {
      await navigator.clipboard.writeText(blob);
      setCopied('ok');
      setTimeout(() => setCopied('idle'), 2000);
    } catch {
      // PWA webview on iOS sometimes blocks clipboard outside a user
      // gesture; prompt() gives the user a manual copy path.
      try {
        window.prompt('העתק את התוכן:', blob);
        setCopied('ok');
        setTimeout(() => setCopied('idle'), 2000);
      } catch {
        setCopied('err');
        setTimeout(() => setCopied('idle'), 2000);
      }
    }
  }

  function onClear() {
    clear();
    refresh();
  }

  const patientCount = stats?.patients ?? 0;
  const noteCount = stats?.notes ?? 0;
  const estBytes = humanizeBytes(stats?.estimatedBytes ?? 0);
  const keyPrefix = cfg.keyPrefix ? `${cfg.keyPrefix}…` : '(none)';

  return (
    <div className="card" style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span className="pill pill-info">v{APP_VERSION}</span>
        <span className="pill pill-muted">{patientCount} מטופלים</span>
        <span className="pill pill-muted">{noteCount} רשומות</span>
        <span className="pill pill-muted">{estBytes}</span>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
          <button className="ghost" onClick={onCopy} type="button">
            {copied === 'ok' ? '✓ הועתק' : copied === 'err' ? 'שגיאה' : '📋 העתק snapshot'}
          </button>
          <button className="ghost" onClick={onClear} type="button">
            🗑 נקה
          </button>
        </div>
      </div>

      <section>
        <h3 className="debug-label">Supabase</h3>
        <pre className="debug-pre" dir="ltr">{`${cfg.url}
key: ${keyPrefix}`}</pre>
      </section>

      <section>
        <h3 className="debug-label">IndexedDB</h3>
        <pre className="debug-pre" dir="ltr">{`patients: ${patientCount}
notes:    ${noteCount}
bytes ≈   ${stats?.estimatedBytes ?? 0}
oldest:   ${fmtTs(stats?.oldestNoteAt ?? null)}
newest:   ${fmtTs(stats?.newestNoteAt ?? null)}`}</pre>
      </section>

      <section>
        <h3 className="debug-label">Last Extract</h3>
        <pre className="debug-pre" dir="ltr">{entryJson(snap.extract)}</pre>
      </section>

      <section>
        <h3 className="debug-label">Last Emit</h3>
        <pre className="debug-pre" dir="ltr">{entryJson(snap.emit)}</pre>
      </section>

      <section>
        <h3 className="debug-label">Last Error</h3>
        <pre className="debug-pre" dir="ltr">{entryJson(snap.error)}</pre>
      </section>
    </div>
  );
}

function buildSnapshotText(args: {
  snap: Snapshot;
  stats: DbStats | null;
  cfg: { url: string; keyPrefix: string };
}): string {
  const { snap, stats, cfg } = args;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '(no-ua)';
  return [
    `ward-helper v${APP_VERSION} · ${new Date().toISOString()}`,
    `UA: ${ua}`,
    `Supabase: ${cfg.url}`,
    `IDB: patients=${stats?.patients ?? 0} notes=${stats?.notes ?? 0} bytes≈${stats?.estimatedBytes ?? 0}`,
    '',
    '=== extract ===',
    entryJson(snap.extract),
    '',
    '=== emit ===',
    entryJson(snap.emit),
    '',
    '=== error ===',
    entryJson(snap.error),
  ].join('\n');
}
