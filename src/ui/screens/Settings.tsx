import { useState, useEffect, useRef } from 'react';
import {
  useBidiAudit,
  useDebugPanel,
  useDaySnapshotCloudSync,
  useEmailTarget,
} from '../hooks/useSettings';
import { load as loadCosts, reset as resetCosts } from '@/agent/costs';
import { restoreFromCloud, type RestoreResult } from '@/notes/save';
import { DebugPanel } from '../components/DebugPanel';
import {
  loadSnippets,
  saveSnippets,
  type SnippetMap,
} from '@/notes/snippets';
import { AccountSection } from '../components/AccountSection';
import {
  getCurrentUser,
  getLastLoginPasswordOrNull,
} from '@/auth/auth';
import { pushAllToCloud } from '@/notes/manualPush';
import { clearOrphanProtection } from '@/storage/canaryProtection';
import { exportLocalBackup } from '@/notes/exportLocal';
import { importLocalBackup } from '@/notes/importLocal';
import { pushBreadcrumb } from '../components/MobileDebugPanel';

export function Settings() {
  const [msg, setMsg] = useState('');
  const [bidiAuditOn, setBidiAuditOn] = useBidiAudit();
  const [debugOn, setDebugOn] = useDebugPanel();
  const [daySnapCloudOn, setDaySnapCloudOn] = useDaySnapshotCloudSync();
  const [emailTarget, setEmailTargetValue] = useEmailTarget();
  const [emailDraft, setEmailDraft] = useState(emailTarget);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreErr, setRestoreErr] = useState('');
  const [pushingNow, setPushingNow] = useState(false);
  // v1.39.14: surface the v1.39.9 orphan-canary detection. When true, a
  // warning panel + "overwrite anyway" button appears next to the push
  // button. Clicking the override calls clearOrphanProtection() and
  // re-runs the push so the doctor doesn't have to click twice.
  const [canaryOrphanPending, setCanaryOrphanPending] = useState(false);
  // Snippet editor: rows are mutable until "Save". Loaded once on mount and
  // kept as an array of pairs for ordered rendering — Object would lose
  // insertion order under JSON round-trip in some IDB implementations.
  const [snippetRows, setSnippetRows] = useState<{ key: string; val: string }[]>([]);
  const [snippetMsg, setSnippetMsg] = useState('');
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

  // v1.35.0: cloud encryption uses the login password (stashed in memory by
  // AccountSection on successful login). If null (guest, or post-reload before
  // re-login), restore is impossible — show a clear "log in again" message
  // instead of prompting for a separate passphrase.
  async function onRestore() {
    const p = getLastLoginPasswordOrNull();
    if (!p) {
      setRestoreErr('צריך להתנתק ולהתחבר מחדש כדי לשחזר מהענן (סיסמת הכניסה לא בזיכרון).');
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

      {/*
        Anthropic API Key UI moved into AccountSection (visible when logged in).
        That field has /v1/models validation + server-side mirror so the key
        survives a fresh-device login.

        v1.35.0: backup-passphrase UI removed at user request after multiple
        failed activation attempts (see git history for v1.34.0..v1.34.4).
        Cloud encryption now uses the user's login password directly via
        PBKDF2 — no separate passphrase prompt, no canary check at activation.
        The crypto modules (src/crypto/unlock.ts, src/storage/canary.ts,
        src/notes/manualPush.ts) remain in the codebase and may be re-wired
        in a future version.

        Below: cloud + local backup actions, gated only on being logged in.
        Cloud ops silently no-op for guests (no login password to derive a
        key from).
      */}

      <h2>גיבוי</h2>
      {(() => {
        const username = getCurrentUser()?.username ?? null;
        if (!username) {
          return (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              התחבר לחשבון כדי לאפשר גיבוי לענן. אורחים יכולים עדיין לייצא/לייבא קובץ מקומי.
            </p>
          );
        }
        return (
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            הגיבוי מוצפן עם סיסמת הכניסה שלך (אין סיסמה נוספת). שמירות חדשות
            נדחפות לענן אוטומטית. הכפתור למטה דוחף את כל המטופלים וההערות שיש כעת במכשיר.
          </p>
        );
      })()}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={pushingNow}
          onClick={async () => {
            const username = getCurrentUser()?.username ?? null;
            const loginPwd = getLastLoginPasswordOrNull();
            if (!username || !loginPwd) {
              alert(
                'אי-אפשר לדחוף לענן: התנתק והתחבר מחדש כדי שסיסמת הכניסה תיכנס לזיכרון.',
              );
              return;
            }
            setPushingNow(true);
            pushBreadcrumb('cloudPush.click');
            try {
              const out = await pushAllToCloud(loginPwd, username);
              pushBreadcrumb('cloudPush.done', {
                patients: out.pushedPatients,
                notes: out.pushedNotes,
                canary: out.pushedCanary,
                failed: out.failed.length,
                ...(out.canarySkippedOrphan ? { canarySkippedOrphan: true } : {}),
              });
              // Cloud is now under the current login password — clear any
              // stale "wrong passphrase" alert from a prior restore attempt
              // (which would have been against the v1.34 ciphertext). Without
              // this, the user sees a persistent red alert even after a
              // successful push.
              setRestoreResult(null);
              setRestoreErr('');
              if (out.canarySkippedOrphan) {
                // v1.39.14: orphan-canary protection fired. Patient + note
                // pushes still proceeded (those don't share blob_ids with
                // existing data), but the canary marker was preserved so
                // pre-existing cloud rows from a prior passphrase stay
                // recoverable. Surface this clearly so the user can decide
                // whether to override.
                setCanaryOrphanPending(true);
              } else {
                setCanaryOrphanPending(false);
              }
              alert(
                `נשלחו לענן: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות${out.failed.length > 0 ? ` (${out.failed.length} נכשלו)` : ''}${out.canarySkippedOrphan ? ' — סימון canary נשמר על הסיסמה הקודמת (ראה אזהרה למטה)' : ''}.`,
              );
            } catch (e) {
              pushBreadcrumb('cloudPush.err', (e as Error).message);
              alert((e as Error).message);
            } finally {
              setPushingNow(false);
            }
          }}
        >
          {pushingNow ? 'דוחף...' : 'גיבוי לענן עכשיו'}
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
      </div>

      {canaryOrphanPending && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: 12,
            border: '1px solid var(--warn, #b45309)',
            borderRadius: 8,
            background: 'rgba(245, 158, 11, 0.08)',
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            ⚠ נתוני ענן ישנים נשמרו במצב לא נגיש
          </div>
          <div style={{ marginBottom: 8 }}>
            הענן מכיל נתונים שהוצפנו בסיסמה אחרת מהסיסמה הנוכחית. סימון ה-canary
            לא נדרס כדי להגן עליהם — אם תזכור את הסיסמה הקודמת ותתחבר מחדש איתה,
            הנתונים הישנים עדיין נגישים. הנתונים החדשים שהעלית בכל זאת נשמרו בענן
            תחת הסיסמה הנוכחית.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={pushingNow}
              onClick={async () => {
                if (
                  !window.confirm(
                    'אישור — לדרוס את סימון ה-canary של הסיסמה הקודמת. אחרי הפעולה הזו, הנתונים הישנים בענן (אם קיימים) לא יהיו ניתנים לשחזור גם אם תזכור את הסיסמה הקודמת. להמשיך?',
                  )
                ) {
                  return;
                }
                const username = getCurrentUser()?.username ?? null;
                const loginPwd = getLastLoginPasswordOrNull();
                if (!username || !loginPwd) {
                  alert('התנתק והתחבר מחדש לפני הדריסה.');
                  return;
                }
                clearOrphanProtection();
                pushBreadcrumb('canary.orphan.override.click');
                setPushingNow(true);
                try {
                  const out = await pushAllToCloud(loginPwd, username);
                  pushBreadcrumb('cloudPush.done', {
                    patients: out.pushedPatients,
                    notes: out.pushedNotes,
                    canary: out.pushedCanary,
                    failed: out.failed.length,
                    afterOverride: true,
                  });
                  setCanaryOrphanPending(false);
                  alert(
                    `נדרס סימון canary והנתונים הועלו תחת הסיסמה הנוכחית. ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות.`,
                  );
                } catch (e) {
                  alert((e as Error).message);
                } finally {
                  setPushingNow(false);
                }
              }}
            >
              ⚠ דרוס בכל זאת
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setCanaryOrphanPending(false)}
            >
              סגור
            </button>
          </div>
        </div>
      )}

      <h2>שחזור מהענן</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
        מכשיר חדש? IDB נמחק? זה מושך את כל הגיבויים המוצפנים מ-Supabase,
        מפענח אותם עם סיסמת הכניסה הנוכחית, וכותב אותם למכשיר הזה.
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
              הגיבוי בענן הוצפן עם סיסמת כניסה אחרת מהנוכחית (כנראה שינוי סיסמה,
              או נתונים ישנים מגרסה קודמת של האפליקציה). הקלקה למטה תחליף את הגיבוי
              בענן בכל מה שיש לך עכשיו במכשיר.{' '}
              <button
                type="button"
                onClick={async () => {
                  const ok = window.confirm(
                    'פעולה זו תחליף את הגיבוי בענן בכל המטופלים וההערות שיש לך עכשיו במכשיר. הגיבוי הקודם יהיה בלתי שחזיר. להמשיך?',
                  );
                  if (!ok) return;
                  const username = getCurrentUser()?.username ?? null;
                  const loginPwd = getLastLoginPasswordOrNull();
                  if (!username || !loginPwd) {
                    alert('התנתק והתחבר מחדש לפני החלפת הגיבוי.');
                    return;
                  }
                  try {
                    const out = await pushAllToCloud(loginPwd, username);
                    // Drop the stale wrongPassphrase result so the red alert
                    // disappears — cloud is now consistent with the login.
                    setRestoreResult(null);
                    setRestoreErr('');
                    alert(
                      `גיבוי הוחלף: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות.`,
                    );
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                החלף את הגיבוי בענן
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

      <h2>היסטוריית סיכום יום</h2>
      <p
        dir="auto"
        style={{ fontSize: 12, color: 'var(--muted, #666)', marginTop: 4 }}
      >
        שמורה רק במכשיר הזה. סנכרון לענן יתווסף בעתיד.
      </p>

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

      <h2>סנכרון ענן</h2>
      <label className="toggle-row" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={daySnapCloudOn}
          onChange={(e) => setDaySnapCloudOn(e.target.checked)}
        />
        <span>סנכרן היסטוריה לענן (סנאפשוטים יומיים)</span>
      </label>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
        כשמופעל, כל ארכוב יומי נדחף לענן ומסונכרן בין מכשירים. מוצפן עם סיסמת הכניסה. שמור בענן עד 20 ימים אחרונים בלבד. כשכבוי, ארכובים נשמרים מקומית בלבד. הפעלה לא דוחפת ארכובים ישנים — רק את הבאים.
      </p>

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
