import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBlocks } from '@/camera/session';
import { runExtractTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import type { ParseResult, ParseFields, Med } from '@/agent/tools';
import { FieldRow } from '../components/FieldRow';
import { resolveContinuity, type ContinuityContext } from '@/notes/continuity';
import { ContinuityBanner } from '../components/ContinuityBanner';
import { PriorNotesBanner } from '../components/PriorNotesBanner';
import type { SafetyFlags } from '@/safety/types';

type Status = 'loading' | 'ready' | 'error';

const EXTRACT_TIMEOUT_MS = 45_000;

/**
 * Wrap a promise with a hard timeout. On timeout, the promise rejects with
 * a diagnostic message so the Review screen can surface "what went wrong"
 * rather than sitting on "מנתח את המסך..." forever.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${ms / 1000}s: ${label}. בדוק חיבור רשת / מפתח API תקין / מודל זמין.`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function Review() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fields, setFields] = useState<ParseFields>({});
  const [continuity, setContinuity] = useState<ContinuityContext | null>(null);
  const [continuityEnabled, setContinuityEnabled] = useState<boolean>(true);
  const [safetyFlags, setSafetyFlags] = useState<SafetyFlags | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const isSoap = sessionStorage.getItem('noteType') === 'soap';

  // Elapsed-time counter while loading — gives user feedback that work is
  // happening, and surfaces hangs visibly.
  useEffect(() => {
    if (status !== 'loading') return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blocks = listBlocks();
        if (blocks.length === 0) throw new Error('אין קלט לעיבוד');
        const skillContent = await loadSkills(['azma-ui', 'hebrew-medical-glossary']);
        const result = await withTimeout(
          runExtractTurn(blocks, skillContent),
          EXTRACT_TIMEOUT_MS,
          'Anthropic extract call',
        );
        if (cancelled) return;
        setParsed(result);
        setFields(result.fields);
        setStatus('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        const err = e as { message?: string; status?: number; error?: { message?: string } };
        const pieces: string[] = [];
        if (err.status) pieces.push(`HTTP ${err.status}`);
        if (err.error?.message) pieces.push(err.error.message);
        else if (err.message) pieces.push(err.message);
        setError(pieces.join(' — ') || String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-load the safety engine only when there's something to check. The
  // dynamic import puts run.ts (and its rule data) in its own chunk —
  // `import('@/safety/run')`. Recompute when the meds list edits change.
  useEffect(() => {
    const meds = fields.meds ?? [];
    if (meds.length === 0) {
      setSafetyFlags(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { runSafetyChecks } = await import('@/safety/run');
      const result = runSafetyChecks(meds, {
        age: fields.age,
        sex: fields.sex === 'M' || fields.sex === 'F' ? fields.sex : undefined,
        conditions: fields.pmh ?? [],
      });
      if (cancelled) return;
      setSafetyFlags(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [fields.meds, fields.age, fields.sex, fields.pmh]);

  useEffect(() => {
    if (!isSoap) return;
    const tz = fields.teudatZehut?.trim();
    if (!tz) return;
    let cancelled = false;
    (async () => {
      const ctx = await resolveContinuity(tz);
      if (cancelled) return;
      setContinuity(ctx);
      const stored = sessionStorage.getItem('soapContinuity');
      const hasAnyContext = !!(ctx.admission || ctx.priorSoaps.length > 0);
      setContinuityEnabled(stored === 'off' ? false : hasAnyContext);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSoap, fields.teudatZehut]);

  function onToggleContinuity(v: boolean) {
    setContinuityEnabled(v);
    sessionStorage.setItem('soapContinuity', v ? 'on' : 'off');
  }

  if (status === 'loading') {
    return (
      <section>
        <h1>בדיקה</h1>
        <p>מנתח את המסך... ({elapsed}s)</p>
        {elapsed > 15 && (
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
            לוקח זמן מעל הרגיל. אם זה נתקע, בדוק:
            <br />• חיבור אינטרנט
            <br />• שמפתח ה-API בהגדרות תקין (פנייה ישירה ל-Anthropic)
            <br />• תמונות קטנות יותר (פחות מ-3 MB כל אחת)
          </p>
        )}
        {elapsed > 40 && (
          <button className="ghost" onClick={() => nav('/capture')} style={{ marginTop: 12 }}>
            חזרה
          </button>
        )}
      </section>
    );
  }

  if (status === 'error') {
    const is504 = /504|Upstream timeout/i.test(error);
    const allBlocks = listBlocks();
    const imageCount = allBlocks.filter((b) => b.kind === 'image').length;
    const hasPastedText = allBlocks.some((b) => b.kind === 'text');
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--red)', whiteSpace: 'pre-wrap' }}>{error}</p>
        {is504 && (
          <div
            style={{
              background: 'var(--warn)',
              color: 'black',
              padding: 10,
              borderRadius: 8,
              marginTop: 12,
              fontSize: 14,
            }}
          >
            <strong>Timeout נעוץ בריבוי תמונות.</strong>
            <br />
            יש לך {imageCount} תמונות בסשן. ה-AI מעבד כל תמונה בנפרד; מעל 3 תמונות חוצה את הזמן של הפרוקסי (10s).
            <br />
            <strong>תיקון:</strong> חזור, מחק תמונות חלשות ושאיר 1-3 (כותרת AZMA + תרופות + מעבדה).
          </div>
        )}
        <details style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
          <summary>אבחון</summary>
          <ul style={{ paddingInlineStart: 18 }}>
            <li>תמונות בסשן: {imageCount}</li>
            <li>טקסט דבוק: {hasPastedText ? 'כן' : 'לא'}</li>
            <li>זמן מקסימלי: {EXTRACT_TIMEOUT_MS / 1000}s</li>
          </ul>
        </details>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => nav('/capture')}>חזרה לצילום</button>
          <button className="ghost" onClick={() => nav('/settings')}>הגדרות</button>
        </div>
      </section>
    );
  }

  if (!parsed) return null;

  const update =
    <K extends keyof ParseFields>(k: K) =>
    (v: string) => {
      if (k === 'age') {
        const n = Number(v);
        setFields({ ...fields, age: Number.isFinite(n) && n > 0 ? n : undefined });
      } else {
        setFields({ ...fields, [k]: v });
      }
    };

  function updateMed(i: number, patch: Partial<Med>) {
    const meds = [...(fields.meds ?? [])];
    const existing = meds[i] ?? { name: '' };
    meds[i] = { ...existing, ...patch };
    setFields({ ...fields, meds });
  }

  function removeMed(i: number) {
    const meds = (fields.meds ?? []).filter((_, j) => j !== i);
    setFields({ ...fields, meds });
  }

  function addMed() {
    setFields({ ...fields, meds: [...(fields.meds ?? []), { name: '' }] });
  }

  const lowConfMeds = Object.entries(parsed.confidence).some(
    ([k, v]) => k.startsWith('meds') && v === 'low',
  );

  function onProceed() {
    sessionStorage.setItem('validated', JSON.stringify(fields));
    sessionStorage.setItem(
      'validatedConfidence',
      JSON.stringify(parsed?.confidence ?? {}),
    );
    if (isSoap && continuity?.patient && continuityEnabled) {
      sessionStorage.setItem('continuityTeudatZehut', continuity.patient.teudatZehut);
    } else {
      sessionStorage.removeItem('continuityTeudatZehut');
    }
    if (safetyFlags) {
      sessionStorage.setItem('validatedSafety', JSON.stringify(safetyFlags));
    } else {
      sessionStorage.removeItem('validatedSafety');
    }
    nav('/edit');
  }

  return (
    <section>
      <h1>בדיקה</h1>

      <PriorNotesBanner tz={fields.teudatZehut} />

      {isSoap && continuity && (
        <ContinuityBanner
          ctx={continuity}
          enabled={continuityEnabled}
          onToggle={onToggleContinuity}
        />
      )}

      {!fields.name && !fields.teudatZehut && (
        <div
          role="alert"
          style={{
            background: 'var(--err-soft)',
            color: 'var(--err)',
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
            border: '1px solid var(--err)',
          }}
        >
          ⚠️ לא זוהו פרטי מטופל (שם / ת.ז.) — מלא ידנית לפני המעבר ליצירת הערה.
        </div>
      )}

      <FieldRow
        label="שם"
        value={fields.name ?? ''}
        confidence={parsed.confidence['name']}
        onChange={update('name')}
        critical
      />
      <FieldRow
        label="ת.ז."
        value={fields.teudatZehut ?? ''}
        confidence={parsed.confidence['teudatZehut']}
        onChange={update('teudatZehut')}
        critical
      />
      <FieldRow
        label="גיל"
        value={String(fields.age ?? '')}
        confidence={parsed.confidence['age']}
        onChange={update('age')}
        critical
      />
      <FieldRow
        label="חדר"
        value={fields.room ?? ''}
        confidence={parsed.confidence['room']}
        onChange={update('room')}
      />
      <FieldRow
        label="תלונה ראשית"
        value={fields.chiefComplaint ?? ''}
        confidence={parsed.confidence['chiefComplaint']}
        onChange={update('chiefComplaint')}
      />

      <h2>תרופות</h2>
      {(fields.meds ?? []).map((m, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr auto',
            gap: 6,
            marginBottom: 6,
          }}
        >
          <input
            dir="ltr"
            value={m.name}
            onChange={(e) => updateMed(i, { name: e.target.value })}
            placeholder="Apixaban"
          />
          <input
            dir="ltr"
            value={m.dose ?? ''}
            onChange={(e) => updateMed(i, { dose: e.target.value })}
            placeholder="5 mg"
          />
          <input
            dir="ltr"
            value={m.freq ?? ''}
            onChange={(e) => updateMed(i, { freq: e.target.value })}
            placeholder="BID"
          />
          <button className="ghost" onClick={() => removeMed(i)}>🗑</button>
        </div>
      ))}
      <button className="ghost" onClick={addMed}>+ תרופה</button>

      <h2>אלרגיות</h2>
      <input
        dir="auto"
        value={(fields.allergies ?? []).join(', ')}
        onChange={(e) =>
          setFields({
            ...fields,
            allergies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
          })
        }
        placeholder="NKDA"
      />

      {lowConfMeds && (
        <div
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: 12,
            borderRadius: 8,
            marginTop: 12,
          }}
        >
          ⚠ צלם שוב את כרטיסיית התרופות כדי לאמת רשומה בעלת ביטחון נמוך לפני המשך
        </div>
      )}

      {safetyFlags && (
        <div
          style={{
            background: 'var(--card)',
            padding: 10,
            borderRadius: 8,
            marginTop: 12,
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
          }}
        >
          <button
            type="button"
            className="ghost"
            onClick={() => setSafetyOpen((v) => !v)}
            style={{
              width: '100%',
              textAlign: 'start',
              padding: '6px 10px',
              minHeight: 36,
              fontSize: 14,
            }}
            aria-expanded={safetyOpen}
          >
            🚨 בדיקת בטיחות תרופתית: Beers ×{safetyFlags.beers.length} · STOPP ×{safetyFlags.stopp.length} · START ×{safetyFlags.start.length} · ACB={safetyFlags.acbScore}
          </button>
          {safetyOpen && (
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
              {(['beers', 'stopp', 'start'] as const).flatMap((kind) =>
                safetyFlags[kind].map((h) => (
                  <div
                    key={`${kind}-${h.code}`}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      paddingBlock: 4,
                      borderBottom: '1px dashed var(--border, rgba(255,255,255,0.08))',
                    }}
                  >
                    <code dir="ltr" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {h.code}
                    </code>
                    <bdi dir="ltr" style={{ fontWeight: 600 }}>{h.drug}</bdi>
                    <span dir="auto" style={{ flex: 1 }}>{h.recommendation}</span>
                  </div>
                )),
              )}
              {safetyFlags.beers.length === 0 &&
                safetyFlags.stopp.length === 0 &&
                safetyFlags.start.length === 0 && (
                  <p style={{ color: 'var(--muted)', margin: 4 }}>
                    אין הצעות מנוע הבטיחות לרשימת התרופות הנוכחית.
                  </p>
                )}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={onProceed}>צור טיוטת רשימה ←</button>
      </div>
    </section>
  );
}
