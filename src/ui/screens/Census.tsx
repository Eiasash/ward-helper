import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { compressImage } from '@/camera/compress';
import { dataUrlToBlob } from '@/camera/session';
import { runCensusExtractTurn, type CensusRow, type CensusResult } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import { upsertCensus, type CensusUpsertResult } from '@/storage/census';
import { getPatientByTz } from '@/storage/indexed';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';

type Status = 'idle' | 'parsing' | 'editing' | 'saving' | 'done' | 'error';

const MIN_ROWS_FOR_VALID_PARSE = 5;

interface InMemoryShot {
  id: string;
  preview: string;
  dataUrl: string;
}

/**
 * AZMA "ניהול מחלקה" census parser.
 *
 * Flow:
 *   1. Snap one or more shots of the department grid.
 *   2. Tap "נתח רשימה" → census extract turn → editable table.
 *   3. Tap "אישור ושמור" → upsert all rows as patient stubs → /today.
 *
 * Census records are not notes; we don't persist a Note row, only patient
 * stubs (insert if new, room+tags update if known). See storage/census.ts.
 */
export function Census() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [shots, setShots] = useState<InMemoryShot[]>([]);
  const [rows, setRows] = useState<CensusRow[]>([]);
  const [parseErr, setParseErr] = useState('');
  const [saveResult, setSaveResult] = useState<CensusUpsertResult | null>(null);

  // Revoke any object URLs created for previews on unmount.
  useEffect(() => {
    return () => {
      for (const s of shots) URL.revokeObjectURL(s.preview);
    };
  }, [shots]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const next: InMemoryShot[] = [];
    for (const f of files) {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(f);
      });
      const compressed = await compressImage(dataUrl, 'census');
      // fetch(dataUrl) is blocked by CSP connect-src; use the synchronous
      // base64 → Blob path instead. See dataUrlToBlob's docblock.
      const blob = dataUrlToBlob(compressed);
      const preview = URL.createObjectURL(blob);
      next.push({ id: crypto.randomUUID(), preview, dataUrl: compressed });
    }
    setShots((prev) => [...prev, ...next]);
    e.target.value = '';
  }

  function removeShot(id: string) {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((s) => s.id !== id);
    });
  }

  async function onParse() {
    if (shots.length === 0) return;
    setStatus('parsing');
    setParseErr('');
    try {
      const skill = await loadSkills(['azma-ui']);
      const result: CensusResult = await runCensusExtractTurn(
        shots.map((s) => s.dataUrl),
        skill,
      );
      // Hard guardrail: < 5 rows = parse failure. A real ward has 20-40
      // patients; <5 means the model misread the screen.
      if (result.rows.length < MIN_ROWS_FOR_VALID_PARSE) {
        setStatus('error');
        setParseErr(
          'לא זוהתה רשימת מחלקה — וודא שצולם המסך המלא של ניהול מחלקה',
        );
        return;
      }
      // v1.39.15: TZ→roster augmentation. The v1.39.7 NAME DISCIPLINE prompt
      // makes the model conservative on paper handover sheets — when names
      // are visually ambiguous (small font, JPEG compression), the model
      // emits empty strings rather than risk a header bleed. Cross-reference
      // each extracted TZ against IndexedDB. If we've seen this patient
      // before, fill in the name from the existing record. Validator-before-
      // prompt: deterministic, free, self-improving (every successful name
      // extraction in the past helps future ones). Per memory
      // feedback_validator_before_prompt.md.
      let augmentedFromRoster = 0;
      const augmented: CensusRow[] = await Promise.all(
        result.rows.map(async (row) => {
          if (row.name?.trim()) return row;
          if (!row.teudatZehut) return row;
          const known = await getPatientByTz(row.teudatZehut);
          if (known?.name) {
            augmentedFromRoster++;
            return { ...row, name: known.name };
          }
          return row;
        }),
      );
      if (augmentedFromRoster > 0) {
        pushBreadcrumb('census.augmentedFromRoster', {
          augmented: augmentedFromRoster,
          totalRows: augmented.length,
        });
      }
      setRows(augmented);
      setStatus('editing');
    } catch (e) {
      setParseErr((e as Error).message ?? 'parse failed');
      setStatus('error');
    }
  }

  function updateRow(i: number, patch: Partial<CensusRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function deleteRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onConfirm() {
    setStatus('saving');
    try {
      const result = await upsertCensus(rows);
      setSaveResult(result);
      setStatus('done');
      // Brief pause for confirmation read, then jump to /today.
      setTimeout(() => nav('/today'), 1200);
    } catch (e) {
      setParseErr((e as Error).message ?? 'save failed');
      setStatus('error');
    }
  }

  if (status === 'parsing') {
    return (
      <section>
        <h1>מנתח רשימה...</h1>
        <p style={{ color: 'var(--muted)' }}>זה לוקח כ-15 שניות.</p>
      </section>
    );
  }

  if (status === 'saving') {
    return (
      <section>
        <h1>שומר רשימה...</h1>
      </section>
    );
  }

  if (status === 'done' && saveResult) {
    return (
      <section>
        <h1>נשמר ✓</h1>
        <p>
          חדשים: {saveResult.inserted} · עודכנו: {saveResult.updated} · דולגו: {saveResult.skipped}
        </p>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--warn)' }}>{parseErr}</p>
        <button onClick={() => setStatus('idle')}>חזור לצילום</button>
      </section>
    );
  }

  if (status === 'editing') {
    return (
      <section>
        <h1>בדיקת רשימה ({rows.length} מטופלים)</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          ערוך שגיאות לפני שמירה. שורות עם ת.ז. ריקה לא יישמרו.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'start' }}>שם</th>
                <th style={{ textAlign: 'start' }}>ת.ז.</th>
                <th style={{ textAlign: 'start' }}>חדר</th>
                <th>דגלים</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
                  <td>
                    <input
                      dir="auto"
                      value={r.name}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      dir="ltr"
                      value={r.teudatZehut ?? ''}
                      onChange={(e) =>
                        updateRow(i, { teudatZehut: e.target.value || null })
                      }
                      style={{ width: 110 }}
                    />
                  </td>
                  <td>
                    <input
                      dir="ltr"
                      value={r.room}
                      onChange={(e) => updateRow(i, { room: e.target.value })}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {r.isolation && '🔴 '}
                    {r.ventilation && '🫁 '}
                    {r.bloodBankColor && `🩸${r.bloodBankColor[0]} `}
                    {r.unsignedAdmission && '✏️ '}
                    {r.unsignedShiftSummary && '🟢 '}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => deleteRow(i)}
                      aria-label={`מחק שורה ${i + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onConfirm}>אישור ושמור</button>
          <button className="ghost" onClick={() => setStatus('idle')}>חזור</button>
        </div>
      </section>
    );
  }

  // status === 'idle'
  return (
    <section>
      <h1>רשימת מחלקה</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        צלם מסך אחד או יותר של "ניהול מחלקה" ב-AZMA. המנתח יזהה כל שורה וייצר רשימה לעריכה.
      </p>

      <label
        className="visually-hidden"
        htmlFor="census-pick"
        style={{ position: 'absolute', left: -9999 }}
      >
        בחר תמונות
      </label>
      <label
        htmlFor="census-pick"
        className="ghost"
        style={{
          display: 'inline-block',
          padding: '8px 14px',
          minHeight: 36,
          borderRadius: 6,
          cursor: 'pointer',
          marginInlineEnd: 8,
        }}
      >
        📷 הוסף תמונות
      </label>
      <input
        id="census-pick"
        type="file"
        accept="image/*"
        multiple
        onChange={onPick}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />

      {shots.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            overflowX: 'auto',
            paddingBlock: 8,
          }}
        >
          {shots.map((s) => (
            <div key={s.id} style={{ position: 'relative', flex: '0 0 auto' }}>
              <img
                src={s.preview}
                alt="shot"
                style={{
                  width: 100,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 4,
                }}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => removeShot(s.id)}
                aria-label="הסר תמונה"
                style={{
                  position: 'absolute',
                  top: 2,
                  insetInlineEnd: 2,
                  fontSize: 11,
                  padding: '0 6px',
                  minHeight: 20,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={onParse} disabled={shots.length === 0}>
          נתח רשימה
        </button>
        <button className="ghost" onClick={() => nav('/today')}>
          חזרה
        </button>
      </div>
    </section>
  );
}
