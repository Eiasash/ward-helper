import { useState, useEffect, useRef } from 'react';
import {
  useApiKey,
  setPassphrase,
  getPassphrase,
  clearPassphrase,
  useBidiAudit,
  useDebugPanel,
  useEmailTarget,
} from '../hooks/useSettings';
import { load as loadCosts, reset as resetCosts } from '@/agent/costs';
import { restoreFromCloud, type RestoreResult } from '@/notes/save';
import { activePath, type RequestPath } from '@/agent/client';
import { DebugPanel } from '../components/DebugPanel';
import {
  loadSnippets,
  saveSnippets,
  type SnippetMap,
} from '@/notes/snippets';
import { AccountSection } from '../components/AccountSection';
import { pushCanary, verifyCanary } from '@/storage/cloud';
import { cacheUnlockBlob } from '@/crypto/unlock';
import { deriveAesKey } from '@/crypto/pbkdf2';
import {
  getCurrentUser,
  getLastLoginPasswordOrNull,
} from '@/auth/auth';
import { pushAllToCloud } from '@/notes/manualPush';
import { exportLocalBackup } from '@/notes/exportLocal';
import { importLocalBackup } from '@/notes/importLocal';
import { pushBreadcrumb } from '../components/MobileDebugPanel';

export function Settings() {
  const { present, save, clear } = useApiKey();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [bidiAuditOn, setBidiAuditOn] = useBidiAudit();
  const [debugOn, setDebugOn] = useDebugPanel();
  const [emailTarget, setEmailTargetValue] = useEmailTarget();
  const [emailDraft, setEmailDraft] = useState(emailTarget);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreErr, setRestoreErr] = useState('');
  const [path, setPath] = useState<RequestPath | null>(null);
  // Snippet editor: rows are mutable until "Save". Loaded once on mount and
  // kept as an array of pairs for ordered rendering — Object would lose
  // insertion order under JSON round-trip in some IDB implementations.
  const [snippetRows, setSnippetRows] = useState<{ key: string; val: string }[]>([]);
  const [snippetMsg, setSnippetMsg] = useState('');
  // Reactive mirror of getPassphrase() — the module-level singleton in
  // useSettings doesn't fire React updates, so we shadow it for render-time
  // gating of the passphrase-only sections (manual push / export / import).
  const [passphraseActive, setPassphraseActive] = useState<boolean>(
    () => getPassphrase() !== null,
  );
  // Inline button-state for "הפעל סיסמה". The bottom-of-page <p>{msg}</p>
  // was below the fold on mobile, so users couldn't see whether their tap
  // had registered. This state drives a state pill RIGHT NEXT to the button
  // so feedback is always in viewport.
  type PassSaveState =
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'ok'; text: string }
    | { kind: 'err'; text: string }
    | { kind: 'wrongPass'; rejectedPass: string };
  const [passSaveState, setPassSaveState] = useState<PassSaveState>({ kind: 'idle' });
  const [overwriting, setOverwriting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSnippets().then((m) => {
      setSnippetRows(Object.entries(m).map(([key, val]) => ({ key, val })));
    });
  }, []);

  function updateRow(i: number, patch: Partial<{ key: string; val: string }>) {
    setSnippetRows((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    setSnippetRows((rows) => [...rows, { key: '', val: '' }]);
  }

  function removeRow(i: number) {
    setSnippetRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function onSaveSnippets() {
    const map: SnippetMap = {};
    for (const r of snippetRows) {
      const k = r.key.trim();
      if (!k) continue;
      // Validate trigger pattern at save-time so users see a clear error
      // rather than silent "snippet doesn't fire" later.
      if (!/^\/[a-z]{1,4}$/.test(k)) {
        setSnippetMsg(`טריגר לא תקין: "${k}" — חייב להיות /a עד /abcd`);
        return;
      }
      map[k] = r.val;
    }
    await saveSnippets(map);
    setSnippetMsg('קטעי טקסט נשמרו ✓');
  }

  // Re-runs whenever `present` flips (save/clear in useApiKey bumps it).
  // No polling, no refresh button — the path only changes when the key changes.
  useEffect(() => {
    let cancelled = false;
    activePath().then((p) => {
      if (!cancelled) setPath(p);
    });
    return () => {
      cancelled = true;
    };
  }, [present]);

  async function onSaveKey() {
    if (!key.startsWith('sk-ant-')) {
      setMsg('מפתח לא תקין');
      return;
    }
    await save(key);
    setKey('');
    setMsg('מפתח נשמר ✓');
  }

  async function onSavePass() {
    pushBreadcrumb('savePass.click', { len: pass.length });
    if (pass.length < 8) {
      setPassSaveState({ kind: 'err', text: 'סיסמה קצרה מדי (לפחות 8 תווים)' });
      pushBreadcrumb('savePass.tooShort');
      return;
    }
    const p = pass;
    setPassSaveState({ kind: 'busy' });
    setPassphrase(p);
    const username = getCurrentUser()?.username ?? null;
    pushBreadcrumb('savePass.verifyCanary.start', { username });
    let status: 'ok' | 'wrong-passphrase' | 'absent' | 'error' = 'error';
    try {
      status = await verifyCanary(p, username);
      pushBreadcrumb('savePass.verifyCanary.done', { status });
    } catch (e) {
      // Network/cloud unreachable — still let the user activate the passphrase
      // locally so saves can be queued. Surface a soft warning.
      console.warn('verifyCanary failed', e);
      pushBreadcrumb('savePass.verifyCanary.err', (e as Error).message);
      setPass('');
      setPassphraseActive(true);
      setPassSaveState({
        kind: 'ok',
        text: `✓ הופעלה (לא ניתן היה לאמת מול הענן: ${(e as Error).message})`,
      });
      return;
    }
    if (status === 'wrong-passphrase') {
      // Bail without keeping the bad passphrase active. Surface the recovery
      // path inline (overwrite cloud canary + everything with this passphrase)
      // so the user has a way out without navigating to the restore section.
      clearPassphrase();
      setPassphraseActive(false);
      setPassSaveState({ kind: 'wrongPass', rejectedPass: p });
      return;
    }
    if (status === 'absent') {
      // First-time activation: push a canary so future verifications work.
      try {
        const canarySalt = crypto.getRandomValues(
          new Uint8Array(16),
        ) as Uint8Array<ArrayBuffer>;
        const canaryKey = await deriveAesKey(p, canarySalt);
        await pushCanary(canaryKey, canarySalt, username);
        pushBreadcrumb('savePass.pushCanary.ok');
      } catch (e) {
        console.warn('pushCanary failed', e);
        pushBreadcrumb('savePass.pushCanary.err', (e as Error).message);
      }
    }
    // Cache the unlock blob with the user's login password — so next login
    // auto-unlocks without prompting.
    const loginPwd = getLastLoginPasswordOrNull();
    pushBreadcrumb('savePass.cacheUnlock.check', { hasLoginPwd: !!loginPwd });
    if (loginPwd) {
      try {
        await cacheUnlockBlob(p, loginPwd);
        pushBreadcrumb('savePass.cacheUnlock.ok');
      } catch (e) {
        console.warn('cacheUnlockBlob failed', e);
        pushBreadcrumb('savePass.cacheUnlock.err', (e as Error).message);
      }
    }
    setPass('');
    setPassphraseActive(true);
    setPassSaveState({
      kind: 'ok',
      text: loginPwd ? '✓ הופעלה ונשמרה לכניסה הבאה' : '✓ הופעלה (אבל לא נשמרה — התנתק והתחבר מחדש כדי שתישמר)',
    });
  }

  async function onClearKey() {
    await clear();
    setMsg('מפתח נמחק');
  }

  async function onRestore() {
    const p = getPassphrase();
    if (!p) {
      setRestoreErr('הפעל קודם את סיסמת הגיבוי למעלה — צריך אותה כדי לפענח את הגיבוי בענן.');
      return;
    }
    if (!confirm(
      'זה ימשוך את כל הרשומות המוצפנות מהענן ויכתוב אותן למכשיר הזה. ' +
      'רשומות מקומיות עם אותו מזהה יוחלפו. להמשיך?'
    )) return;
    setRestoring(true);
    setRestoreErr('');
    setRestoreResult(null);
    try {
      const res = await restoreFromCloud(p);
      setRestoreResult(res);
    } catch (e) {
      setRestoreErr((e as Error).message ?? 'נכשל');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section>
      <h1>הגדרות</h1>

      <AccountSection />

      <h2>Anthropic API Key</h2>
      <div
        style={{
          background: 'var(--card)',
          padding: '4px 10px',
          borderRadius: 6,
          marginBottom: 8,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {path === null
          ? '…'
          : path === 'direct'
          ? '🟢 פנייה ישירה (api.anthropic.com)'
          : '🟡 Toranot proxy — פסק זמן 10 שניות'}
      </div>
      {present === null ? (
        <p>...</p>
      ) : present ? (
        <p>
          ✓ מפתח אישי מוגדר — פניות ישירות ל-<code>api.anthropic.com</code>
        </p>
      ) : (
        <div
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: 10,
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong>אין מפתח — משתמש ב-Toranot proxy.</strong>
          <br />
          הפרוקסי קצוב ל-10 שניות ונפסק בשגיאת 504 על רישומים ארוכים (קבלה/שחרור).
          הגדר מפתח כדי לעקוף את המגבלה הזאת.
        </div>
      )}
      <label htmlFor="settings-api-key" className="visually-hidden">Anthropic API key</label>
      <input
        id="settings-api-key"
        type="password"
        dir="ltr"
        placeholder="sk-ant-..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="off"
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSaveKey}>שמור מפתח</button>
        {present && <button className="ghost" onClick={onClearKey}>מחק</button>}
      </div>

      <h2>סיסמת גיבוי (Supabase)</h2>
      <p>{passphraseActive ? '✓ פעילה (עד התנתקות או רענון)' : 'לא פעילה — הגיבוי לא ירוץ'}</p>
      <label htmlFor="settings-passphrase" className="visually-hidden">סיסמת גיבוי</label>
      <input
        id="settings-passphrase"
        type="password"
        dir="auto"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        autoComplete="new-password"
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={onSavePass} disabled={passSaveState.kind === 'busy'}>
          {passSaveState.kind === 'busy' ? 'מפעיל...' : 'הפעל סיסמה'}
        </button>
        <button
          className="ghost"
          onClick={() => {
            clearPassphrase();
            setPassphraseActive(false);
            setPassSaveState({ kind: 'idle' });
            pushBreadcrumb('savePass.cleared');
          }}
        >
          נקה סיסמה
        </button>
        {passSaveState.kind === 'ok' && (
          <span
            role="status"
            style={{
              color: '#059669',
              fontSize: 13,
              fontWeight: 600,
              marginInlineStart: 4,
            }}
          >
            {passSaveState.text}
          </span>
        )}
        {passSaveState.kind === 'err' && (
          <span
            role="alert"
            style={{
              color: '#b91c1c',
              fontSize: 13,
              fontWeight: 600,
              marginInlineStart: 4,
            }}
          >
            {passSaveState.text}
          </span>
        )}
        {passSaveState.kind === 'wrongPass' && (
          <div
            role="alert"
            style={{
              color: '#b91c1c',
              fontSize: 13,
              fontWeight: 600,
              flexBasis: '100%',
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            הסיסמה שגויה — היא לא תואמת את הסיסמה ששמרה את הגיבוי בענן.
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={overwriting}
                onClick={async () => {
                  if (
                    !window.confirm(
                      'פעולה זו תחליף את הגיבוי הקיים בענן בכל המטופלים וההערות שיש לך עכשיו במכשיר, מוצפנים מחדש עם הסיסמה הזו. הגיבוי הקיים יהיה בלתי שחזיר. להמשיך?',
                    )
                  ) {
                    return;
                  }
                  pushBreadcrumb('savePass.overwrite.click');
                  setOverwriting(true);
                  const username = getCurrentUser()?.username ?? null;
                  const rejected =
                    passSaveState.kind === 'wrongPass'
                      ? passSaveState.rejectedPass
                      : '';
                  try {
                    const out = await pushAllToCloud(rejected, username);
                    pushBreadcrumb('savePass.overwrite.done', {
                      patients: out.pushedPatients,
                      notes: out.pushedNotes,
                      canary: out.pushedCanary,
                      failed: out.failed.length,
                    });
                    // Activate locally now that the cloud agrees with this passphrase.
                    setPassphrase(rejected);
                    setPassphraseActive(true);
                    // Cache the unlock blob if the login password is in memory.
                    const loginPwd = getLastLoginPasswordOrNull();
                    if (loginPwd) {
                      try {
                        await cacheUnlockBlob(rejected, loginPwd);
                      } catch (e) {
                        console.warn('cacheUnlockBlob failed', e);
                      }
                    }
                    setPass('');
                    setPassSaveState({
                      kind: 'ok',
                      text: `✓ הגיבוי הוחלף — ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות`,
                    });
                  } catch (e) {
                    pushBreadcrumb('savePass.overwrite.err', (e as Error).message);
                    setPassSaveState({
                      kind: 'err',
                      text: `החלפה נכשלה: ${(e as Error).message}`,
                    });
                  } finally {
                    setOverwriting(false);
                  }
                }}
              >
                {overwriting ? 'מחליף...' : 'התחל מחדש (יחליף בענן)'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setPassSaveState({ kind: 'idle' });
                  setPass('');
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}
        {passSaveState.kind === 'busy' && (
          <span
            role="status"
            aria-live="polite"
            style={{
              color: 'var(--muted)',
              fontSize: 13,
              marginInlineStart: 4,
            }}
          >
            מאמת מול הענן...
          </span>
        )}
      </div>

      {passphraseActive && (
        <section className="cloud-actions" dir="rtl">
          <h3>גיבויים ידניים</h3>
          <button
            type="button"
            onClick={async () => {
              try {
                const out = await pushAllToCloud(
                  getPassphrase() ?? '',
                  getCurrentUser()?.username ?? null,
                );
                alert(
                  `נשלחו לענן: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות${out.failed.length > 0 ? ` (${out.failed.length} נכשלו)` : ''}.`,
                );
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            גיבוי לענן עכשיו
          </button>

          <button
            type="button"
            onClick={async () => {
              const wantPlain = !window.confirm(
                'להצפין עם סיסמת הכניסה (מומלץ)?\n\nאישור = הצפן (מאובטח). ביטול = טקסט גלוי (לחירום בלבד).',
              );
              const loginPwd = getLastLoginPasswordOrNull();
              if (!wantPlain && !loginPwd) {
                alert(
                  'אי-אפשר להצפין: לא נשמרה סיסמת כניסה במהלך ההתחברות. נסה להתנתק ולהתחבר מחדש לפני ייצוא מוצפן.',
                );
                return;
              }
              try {
                const blob = await exportLocalBackup({
                  encryptWithLoginPassword: !wantPlain,
                  loginPassword: !wantPlain ? loginPwd! : undefined,
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ward-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            ייצא גיבוי מקומי
          </button>

          <input
            type="file"
            accept="application/json"
            ref={importInputRef}
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const out = await importLocalBackup(f, {
                  loginPassword: getLastLoginPasswordOrNull() ?? '',
                });
                alert(
                  `יובאו ${out.imported.patients} מטופלים ו-${out.imported.notes} הערות.`,
                );
              } catch (err) {
                alert((err as Error).message);
              } finally {
                e.target.value = '';
              }
            }}
          />
          <button type="button" onClick={() => importInputRef.current?.click()}>
            ייבא גיבוי מקומי
          </button>
        </section>
      )}

      <h2>שחזור מהענן</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
        מכשיר חדש? IDB נמחק? זה מושך את כל הגיבויים המוצפנים מ-Supabase,
        מפענח אותם עם סיסמת הגיבוי שלמעלה, וכותב אותם למכשיר הזה.
      </p>
      <button
        onClick={onRestore}
        disabled={restoring}
        className="ghost"
      >
        {restoring ? 'משחזר...' : '⬇ שחזר מהענן'}
      </button>
      {restoreResult && (
        <div
          style={{
            background: 'var(--card)',
            padding: 10,
            borderRadius: 8,
            marginTop: 8,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {restoreResult.wrongPassphrase ? (
            <p className="restore-error" style={{ margin: 0 }}>
              הסיסמה שגויה (לא הסיסמה ששמרה את הגיבויים בענן).{' '}
              <button
                type="button"
                onClick={async () => {
                  const ok = window.confirm(
                    'פעולה זו תחליף את הגיבוי בענן בכל המטופלים וההערות שיש לך עכשיו במכשיר. להמשיך?',
                  );
                  if (!ok) return;
                  try {
                    const out = await pushAllToCloud(
                      getPassphrase() ?? '',
                      getCurrentUser()?.username ?? null,
                    );
                    alert(
                      `גיבוי הוחלף: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות.`,
                    );
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                התחל מחדש (יחליף בענן)
              </button>
            </p>
          ) : (
            <>
              <strong>שוחזר ✓</strong>
              {' '}
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                ({restoreResult.source === 'username' ? 'חשבון מחובר' : 'מכשיר זה'})
              </span>
              <br />
              נסרקו: {restoreResult.scanned}
              {' · '}שוחזרו מטופלים: {restoreResult.restoredPatients}
              {' · '}הערות: {restoreResult.restoredNotes}
              {restoreResult.skipped.length > 0 && (
                <>
                  <br />
                  דילוג: {restoreResult.skipped.length} רשומות (פורמט לא נתמך).
                  ראה console.
                </>
              )}
            </>
          )}
        </div>
      )}
      {restoreErr && (
        <p style={{ color: 'var(--warn)', fontSize: 13, marginTop: 8 }}>
          {restoreErr}
        </p>
      )}

      <h2>עלות מצטברת</h2>
      {(() => {
        const c = loadCosts();
        return (
          <p>
            ${c.usd.toFixed(3)} · {c.inputTokens + c.outputTokens} tokens
            {' '}
            ({c.inputTokens} in / {c.outputTokens} out)
          </p>
        );
      })()}
      <button
        className="ghost"
        onClick={() => {
          resetCosts();
          setMsg('עלויות אופסו');
        }}
      >
        אפס מונה
      </button>

      <h2>שליחה במייל (Gmail)</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
        אחרי שמירה תופיע כפתור "שלח במייל" שישלח את ההערה ל-
        <bdi dir="ltr">{emailTarget || 'כתובת שתגדיר כאן'}</bdi>.
      </p>
      <label htmlFor="settings-email" className="visually-hidden">כתובת מייל ליעד שליחה</label>
      <input
        id="settings-email"
        dir="ltr"
        type="email"
        placeholder="you@example.com"
        value={emailDraft}
        onChange={(e) => setEmailDraft(e.target.value)}
        autoComplete="email"
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => {
            setEmailTargetValue(emailDraft);
            setMsg(emailDraft.trim() ? 'כתובת נשמרה ✓' : 'כתובת נמחקה');
          }}
        >
          שמור כתובת
        </button>
        {emailTarget && (
          <button
            className="ghost"
            onClick={() => {
              setEmailTargetValue('');
              setEmailDraft('');
              setMsg('כתובת נמחקה');
            }}
          >
            מחק
          </button>
        )}
      </div>

      <h2>קטעי טקסט</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
        הקלד טריגר (למשל <code>/nc</code>) ואחריו רווח בעורך — הטקסט המתאים יתפרס אוטומטית.
        טריגר חייב להתחיל ב-<code>/</code> ולהכיל 1-4 אותיות אנגליות קטנות.
      </p>
      {snippetRows.map((r, i) => (
        <div
          key={i}
          style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}
        >
          <input
            dir="ltr"
            placeholder="/nc"
            value={r.key}
            onChange={(e) => updateRow(i, { key: e.target.value })}
            style={{ flex: '0 0 90px' }}
            aria-label={`טריגר שורה ${i + 1}`}
          />
          <input
            dir="auto"
            placeholder="טקסט להחלפה"
            value={r.val}
            onChange={(e) => updateRow(i, { val: e.target.value })}
            style={{ flex: 1 }}
            aria-label={`טקסט שורה ${i + 1}`}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => removeRow(i)}
            aria-label={`מחק שורה ${i + 1}`}
            style={{ flex: '0 0 auto', minHeight: 32, padding: '4px 10px', fontSize: 13 }}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="ghost" onClick={addRow}>
          + הוסף קטע
        </button>
        <button type="button" onClick={onSaveSnippets}>
          שמור קטעים
        </button>
      </div>
      {snippetMsg && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
          {snippetMsg}
        </p>
      )}

      <h2>אבחון מפתחים</h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={bidiAuditOn}
          onChange={(e) => setBidiAuditOn(e.target.checked)}
        />
        הצג באנר audit של כללי Chameleon בעורך ההערה
      </label>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
        מציג הפרות שהמודל הפיק לפני ה-sanitizer. מיועד לכיול prompts. השאר כבוי בשימוש קליני.
      </p>

      <h2>דיבוג</h2>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={debugOn}
          onChange={(e) => setDebugOn(e.target.checked)}
        />
        <span>הצג מידע debug</span>
      </label>
      {debugOn && <DebugPanel />}

      {msg && <p style={{ color: 'var(--muted)', marginTop: 24 }}>{msg}</p>}
    </section>
  );
}
