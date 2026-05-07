import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBlocks } from '@/camera/session';
import { runExtractTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { applyRosterSeedFromStorage } from '@/notes/rosterSeed';
import { isValidIsraeliTzLuhn } from '@/notes/israeliTz';
import { pushBreadcrumb } from '../components/MobileDebugPanel';
import type { ParseResult, ParseFields, Med } from '@/agent/tools';
import { FieldRow } from '../components/FieldRow';
import { resolveContinuity, type ContinuityContext } from '@/notes/continuity';
import { ContinuityBanner } from '../components/ContinuityBanner';
import { PriorNotesBanner } from '../components/PriorNotesBanner';
import type { SafetyFlags } from '@/safety/types';
import { notifyPatientChanged } from '../hooks/useGlanceable';
import { CapturePhaseBeads } from '../components/CapturePhaseBeads';
import { SafetyHighlightedText } from '../components/SafetyHighlightedText';

type Status = 'loading' | 'ready' | 'error';
type LoadingPhase = 'capturing' | 'compressing' | 'awaiting-ai';

const EXTRACT_TIMEOUT_MS = 45_000;

/**
 * Hebrew labels for the three critical-identifier field keys, mirroring the
 * label= props used in the FieldRow declarations below. Used by the Proceed
 * gate to surface "נדרש אישור ידני בשדה: שם" with the same vocabulary the
 * doctor sees on the FieldRow itself, so the message is unambiguous.
 */
function labelFor(key: 'name' | 'teudatZehut' | 'age'): string {
  switch (key) {
    case 'name': return 'שם';
    case 'teudatZehut': return 'ת.ז.';
    case 'age': return 'גיל';
  }
}

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
  // Per-critical-row confirmation state, populated by FieldRow's onConfirmChange
  // callback. Keyed by field name. `undefined` means we haven't received a
  // signal yet (FieldRow's mount-effect hasn't fired) — treated as
  // not-yet-confirmed for safety. `true` means high/med confidence OR the
  // doctor tapped אישור ידני נדרש. `false` means low/missing confidence and
  // not yet acknowledged.
  //
  // Gates the Proceed button below. Closes the v1.21.0-era gap where doctors
  // could ignore the 0.6-opacity visual cue and proceed past unverified
  // extracts. The wire-up was always intended (FieldRow exports
  // isRowConfirmed) but never connected until v1.21.3.
  const [criticalConfirmed, setCriticalConfirmed] = useState<Record<string, boolean>>({});
  const isSoap = sessionStorage.getItem('noteType') === 'soap';

  // v1.39.3: skip-no-clinical state for the button-flip gate. When the
  // SOAP would be a stub (Marciano case — no clinical content extracted),
  // we replace the bare Proceed button with two explicit choices:
  // "Retake photos" (primary) and an inline "Skip" with a required
  // typed reason. Confirm-dialog modal-blindness was rejected explicitly
  // in the v1.39.3 review.
  const [skipExpanded, setSkipExpanded] = useState(false);
  const [skipReason, setSkipReason] = useState('');

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
        // Phase D+E follow-up (chore-roster-single-skip-extract):
        // when the doctor came here via Today.tsx's roster card,
        // sessionStorage holds the RosterPatient identity. Merge it
        // into extract output (roster wins on identity, extract wins
        // on clinical) so the doctor doesn't have to re-photograph
        // the patient card. Same merge function the batch driver uses
        // — single source of truth for the roster→SOAP wiring.
        // One-shot read + clear inside the helper.
        const mergedFields = applyRosterSeedFromStorage(result.fields);
        setParsed(result);
        setFields(mergedFields);
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
        {/* Three-bead choreography: capture + compress already finished
           on the prior screen, so we render those as past steps and
           pulse on awaiting-ai. Replaces the bare "מנתח את המסך..."
           spinner with explicit per-phase microcopy. */}
        <CapturePhaseBeads phase="awaiting-ai" hint={`${elapsed}s`} />
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

  function onProceed(opts: { skipReason?: string } = {}) {
    // v1.39.3: post-extract ת.ז. scrub. The model can return non-9-digit
    // fragments ("666544") OR length-padded Luhn-invalid garbage
    // ("666544000") that would land in the SOAP body and break Chameleon
    // paste downstream. If the doctor entered/confirmed an invalid ת.ז.,
    // we strip it from the persisted validated fields so emit + paste
    // don't propagate broken data. The FieldRow shows what was extracted;
    // this scrub is the last line of defense before /edit.
    const tzCandidate = (fields.teudatZehut ?? '').trim();
    const scrubbed: ParseFields =
      tzCandidate && !isValidIsraeliTzLuhn(tzCandidate)
        ? { ...fields, teudatZehut: undefined }
        : fields;
    if (tzCandidate && !isValidIsraeliTzLuhn(tzCandidate)) {
      pushBreadcrumb('review.tz.scrubbed', {
        len: tzCandidate.length,
        // Don't log the actual tz — partial fingerprint is enough for
        // diagnostics without leaking PHI to the breadcrumb stream.
        firstDigit: tzCandidate[0],
      });
    }

    if (opts.skipReason) {
      pushBreadcrumb('review.skipNoClinical', {
        reason: opts.skipReason.slice(0, 80),
        noteType: 'soap',
      });
    }

    sessionStorage.setItem('validated', JSON.stringify(scrubbed));
    sessionStorage.setItem(
      'validatedConfidence',
      JSON.stringify(parsed?.confidence ?? {}),
    );
    // Header strip subscribes via `ward-helper:patient` — sessionStorage
    // changes don't fire `storage` events in the same tab, so notify directly.
    notifyPatientChanged();
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

  /**
   * v1.39.3: clinical-content detector. SOAP note types need at least
   * one of: chief complaint text, ≥1 med, ≥1 lab, ≥1 PMH item, or any
   * vitals reading. Otherwise the emit produces a Marciano-style stub
   * with "ממתין להשלמת נתונים" placeholders — a real-world failure
   * mode confirmed in the 2026-05-07 audit.
   */
  function hasClinicalContent(f: ParseFields): boolean {
    return Boolean(
      f.chiefComplaint?.trim() ||
        (f.meds?.length ?? 0) > 0 ||
        (f.labs?.length ?? 0) > 0 ||
        (f.pmh?.length ?? 0) > 0 ||
        (f.vitals && Object.keys(f.vitals).length > 0),
    );
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
        onConfirmChange={(c) =>
          setCriticalConfirmed((s) => (s.name === c ? s : { ...s, name: c }))
        }
      />
      <FieldRow
        label="ת.ז."
        value={fields.teudatZehut ?? ''}
        confidence={parsed.confidence['teudatZehut']}
        onChange={update('teudatZehut')}
        critical
        onConfirmChange={(c) =>
          setCriticalConfirmed((s) => (s.teudatZehut === c ? s : { ...s, teudatZehut: c }))
        }
      />
      <FieldRow
        label="גיל"
        value={String(fields.age ?? '')}
        confidence={parsed.confidence['age']}
        onChange={update('age')}
        critical
        onConfirmChange={(c) =>
          setCriticalConfirmed((s) => (s.age === c ? s : { ...s, age: c }))
        }
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

      <h2 id="meds-heading">תרופות</h2>
      <ul aria-labelledby="meds-heading" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(fields.meds ?? []).map((m, i) => (
          <li
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
              aria-label={`שם תרופה שורה ${i + 1}`}
            />
            <input
              dir="ltr"
              value={m.dose ?? ''}
              onChange={(e) => updateMed(i, { dose: e.target.value })}
              placeholder="5 mg"
              aria-label={`מינון תרופה שורה ${i + 1}`}
            />
            <input
              dir="ltr"
              value={m.freq ?? ''}
              onChange={(e) => updateMed(i, { freq: e.target.value })}
              placeholder="BID"
              aria-label={`תדירות תרופה שורה ${i + 1}`}
            />
            <button
              className="ghost"
              onClick={() => removeMed(i)}
              aria-label={`הסר תרופה שורה ${i + 1}`}
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      <button className="ghost" onClick={addMed}>+ תרופה</button>

      <h2 id="allergies-heading">אלרגיות</h2>
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
        aria-labelledby="allergies-heading"
        aria-describedby="allergies-help"
      />
      <small id="allergies-help" style={{ color: 'var(--muted)', fontSize: 12, display: 'block', marginTop: 4 }}>
        הפרד אלרגיות בפסיקים. NKDA אם אין.
      </small>

      {/* Inline drug-safety highlights — surface the v1.20.0 engine's
         hits visually on the med list itself, before the doctor opens
         the (lazy) full panel below. Underlines red for high/critical,
         amber for moderate/low. Tap to see the rule recommendation. */}
      {safetyFlags && (fields.meds?.length ?? 0) > 0 && (
        <div
          aria-label="הדגשות בטיחות תרופתית"
          style={{
            background: 'var(--surface-1)',
            padding: '8px 10px',
            borderRadius: 8,
            marginTop: 8,
            border: '1px solid var(--border)',
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          <SafetyHighlightedText
            text={(fields.meds ?? [])
              .map((m) => [m.name, m.dose, m.freq].filter(Boolean).join(' '))
              .join('  ·  ')}
            flags={safetyFlags}
          />
        </div>
      )}

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

      {(() => {
        // Block Proceed until all 3 critical rows (name, teudatZehut, age) are
        // confirmed. A row is confirmed when it has high/med confidence OR the
        // doctor explicitly tapped אישור ידני נדרש. State is populated by
        // FieldRow's onConfirmChange callback above.
        //
        // `undefined` (FieldRow hasn't reported yet) is treated as
        // not-yet-confirmed so we fail closed during the brief mount window.
        // FieldRow's mount-effect fires on the first render, so this gate
        // self-resolves within one tick for the high-confidence path.
        const allCriticalReady = (['name', 'teudatZehut', 'age'] as const).every(
          (k) => criticalConfirmed[k] === true,
        );
        const blockedFields = (['name', 'teudatZehut', 'age'] as const).filter(
          (k) => criticalConfirmed[k] !== true,
        );

        // v1.39.3: clinical-content gate for SOAP. When extract returns
        // identity-only fields (no clinical content), the model produces
        // a Marciano-style stub. Replace the bare Proceed button with
        // two explicit choices instead of a dismissable confirm dialog
        // (modal-blindness bait — doctors tap through under time pressure).
        const showSoapClinicalGate =
          isSoap && allCriticalReady && !hasClinicalContent(fields);

        return (
          <div style={{ marginTop: 16 }}>
            {showSoapClinicalGate ? (
              <div
                role="region"
                aria-label="אזהרת תוכן קליני חסר"
                style={{
                  background: 'var(--warn-soft, rgba(217,119,6,0.12))',
                  border: '1px solid var(--warn, #d97706)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <p style={{ marginTop: 0, marginBottom: 10, fontSize: 14, lineHeight: 1.5 }}>
                  ⚠ זוהו רק פרטי זהות בלי תוכן קליני (vitals, רשימת בעיות,
                  מעבדה). יצירת SOAP תפיק שדות &quot;ממתין להשלמת נתונים&quot;.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => nav('/capture')}>
                    📷 צלם מחדש (מומלץ)
                  </button>
                  {!skipExpanded ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setSkipExpanded(true)}
                    >
                      המשך ללא תוכן קליני
                    </button>
                  ) : (
                    <>
                      <input
                        dir="auto"
                        value={skipReason}
                        onChange={(e) => setSkipReason(e.target.value)}
                        placeholder="סיבה (חובה — למשל: מטופל יציב, אין שינוי)"
                        aria-label="סיבה לדילוג על תוכן קליני"
                        style={{ flex: 1, minWidth: 220 }}
                      />
                      <button
                        type="button"
                        onClick={() => onProceed({ skipReason: skipReason.trim() })}
                        disabled={skipReason.trim().length < 3}
                      >
                        אישור דילוג
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <button onClick={() => onProceed()} disabled={!allCriticalReady}>
                צור טיוטת רשימה ←
              </button>
            )}
            {!allCriticalReady && (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
                {blockedFields.length === 1 && blockedFields[0]
                  ? `נדרש אישור ידני בשדה: ${labelFor(blockedFields[0])}`
                  : `נדרש אישור ידני בשדות: ${blockedFields.map(labelFor).join(', ')}`}
              </p>
            )}
          </div>
        );
      })()}
    </section>
  );
}
