import { useMemo, useState, type ChangeEvent } from 'react';
import {
  importViaOcr,
  importViaPaste,
  importViaManual,
  type ManualRow,
} from '@/notes/rosterImport';
import type { RosterPatient } from '@/storage/roster';

/**
 * Roster import modal — Phase D, v1.38.0.
 *
 * Three tabs: צילום (OCR via proxy) / הדבקה (paste with format detect) /
 * ידני (manual entry). All three tabs converge on the same preview step
 * before the doctor commits via "ייבא".
 *
 * The preview is mandatory by design: the parsers are permissive, the
 * model occasionally fabricates a row, and the manual tab is fat-finger
 * prone. Forcing one eyeball pass before setRoster lands beats every
 * post-commit "wait, that's not the right name" recovery flow.
 *
 * Mounted permanently in Today.tsx but rendered behind `if (!isOpen) null`
 * so the JSX cost when the modal is closed is zero — only state and
 * handler closures pay rent. The whole component is ~15 KB gzipped at
 * commit-2 size, comfortably within the 180 KB entry chunk budget;
 * if the budget tightens later, a `React.lazy(() => import(...))` is
 * a one-line conversion at the import site.
 */

export interface RosterImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the doctor confirms the preview. Modal does NOT call setRoster directly; that lives in Today.tsx so the post-commit refresh has a single source of truth. */
  onCommit: (rows: RosterPatient[]) => void;
}

type Tab = 'paste' | 'ocr' | 'manual';
type Phase = 'input' | 'preview';

const TAB_LABEL: Record<Tab, string> = {
  paste: 'הדבקה',
  ocr: 'צילום',
  manual: 'ידני',
};

const EMPTY_MANUAL_ROW: ManualRow = { name: '' };

export function RosterImportModal({ isOpen, onClose, onCommit }: RosterImportModalProps) {
  const [tab, setTab] = useState<Tab>('paste');
  const [phase, setPhase] = useState<Phase>('input');
  const [rows, setRows] = useState<RosterPatient[]>([]);

  // Per-tab state. Each tab keeps its own input — switching tabs doesn't
  // wipe the others, so a doctor can paste, glance, switch to manual to
  // add one missed patient, and switch back without losing the paste.
  const [pasteText, setPasteText] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [manualRows, setManualRows] = useState<ManualRow[]>([{ ...EMPTY_MANUAL_ROW }]);

  // Live row count for paste — gives the doctor a "yes, the parser saw
  // 17 rows" affordance without committing to preview yet. Recomputed
  // on every keystroke; cheap (parser is pure regex split).
  const livePasteCount = useMemo(() => {
    if (!pasteText.trim()) return 0;
    try {
      return importViaPaste(pasteText).length;
    } catch {
      return 0;
    }
  }, [pasteText]);

  if (!isOpen) return null;

  function reset() {
    setTab('paste');
    setPhase('input');
    setRows([]);
    setPasteText('');
    setOcrError('');
    setOcrBusy(false);
    setManualRows([{ ...EMPTY_MANUAL_ROW }]);
  }

  function close() {
    reset();
    onClose();
  }

  function commit() {
    if (rows.length === 0) return;
    onCommit(rows);
    reset();
  }

  // ─── Tab 1: paste ────────────────────────────────────────────────
  function onPasteSubmit() {
    const parsed = importViaPaste(pasteText);
    setRows(parsed);
    setPhase('preview');
  }

  // ─── Tab 2: OCR ──────────────────────────────────────────────────
  async function onOcrPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setOcrError('');
    try {
      const parsed = await importViaOcr(file);
      setRows(parsed);
      setPhase('preview');
    } catch (err) {
      setOcrError((err as Error).message ?? 'OCR נכשל');
    } finally {
      setOcrBusy(false);
      e.target.value = '';
    }
  }

  // ─── Tab 3: manual ───────────────────────────────────────────────
  function updateManualRow(i: number, patch: Partial<ManualRow>) {
    setManualRows((prev) => {
      const next = [...prev];
      next[i] = { ...(next[i] ?? EMPTY_MANUAL_ROW), ...patch };
      return next;
    });
  }
  function addManualRow() {
    setManualRows((prev) => [...prev, { ...EMPTY_MANUAL_ROW }]);
  }
  function removeManualRow(i: number) {
    setManualRows((prev) => prev.filter((_, j) => j !== i));
  }
  function onManualSubmit() {
    const parsed = importViaManual(manualRows);
    setRows(parsed);
    setPhase('preview');
  }

  // ─── Preview-step row editing (light) ────────────────────────────
  function editRow(i: number, patch: Partial<RosterPatient>) {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...(next[i] as RosterPatient), ...patch };
      return next;
    });
  }
  function dropRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="roster-modal-title"
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg, #1a1a1a)',
          color: 'var(--fg, #f0f0f0)',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          borderRadius: 12,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
          }}
        >
          <h2 id="roster-modal-title" style={{ margin: 0, fontSize: 17 }}>
            {phase === 'input' ? 'ייבא רשימת מחלקה' : `אישור ייבוא — ${rows.length} מטופלים`}
          </h2>
          <button
            type="button"
            className="ghost"
            onClick={close}
            aria-label="סגור"
            style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}
          >
            ✕
          </button>
        </header>

        {phase === 'input' && (
          <>
            <div
              role="tablist"
              aria-label="שיטות ייבוא"
              style={{ display: 'flex', gap: 4, padding: '8px 12px 0' }}
            >
              {(['paste', 'ocr', 'manual'] as const).map((t) => {
                const active = tab === t;
                return (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t)}
                    className={active ? '' : 'ghost'}
                    style={{
                      minHeight: 36,
                      padding: '6px 12px',
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {TAB_LABEL[t]}
                  </button>
                );
              })}
            </div>

            <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
              {tab === 'paste' && (
                <div>
                  <label htmlFor="roster-paste" className="visually-hidden">
                    טקסט להדבקה
                  </label>
                  <textarea
                    id="roster-paste"
                    dir="auto"
                    rows={12}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={
                      'הדבק רשימה: pipe-format\n' +
                      'id | name | age | room | bed | los | dx\n' +
                      'או AZMA grid TSV (כותרות עם tab).'
                    }
                    style={{
                      width: '100%',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 13,
                      lineHeight: 1.4,
                      minHeight: 220,
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 10,
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {livePasteCount > 0
                        ? `זוהו ${livePasteCount} שורות`
                        : pasteText.trim()
                          ? 'לא זוהה פורמט'
                          : 'הדבק או הקלד טקסט'}
                    </span>
                    <button
                      type="button"
                      onClick={onPasteSubmit}
                      disabled={livePasteCount === 0}
                    >
                      תצוגה מקדימה ←
                    </button>
                  </div>
                </div>
              )}

              {tab === 'ocr' && (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
                    צלם או בחר תמונה של מסך AZMA &quot;ניהול מחלקה&quot;.
                  </p>
                  {/*
                    Label-wrapped input pattern — programmatic .click() on a
                    hidden input fails silently in PWA standalone mode on
                    mobile Chrome. iPhone-specific: capture="environment"
                    fires the rear camera directly.
                  */}
                  <label
                    className="btn-like"
                    aria-label="צלם רשימה"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    📷 צלם / בחר תמונה
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={onOcrPick}
                      disabled={ocrBusy}
                      className="visually-hidden"
                    />
                  </label>
                  {ocrBusy && (
                    <p style={{ marginTop: 12, fontSize: 13 }}>מנתח את התמונה…</p>
                  )}
                  {ocrError && (
                    <div
                      role="alert"
                      className="pill pill-warn"
                      style={{ marginTop: 12, padding: '8px 10px', display: 'block' }}
                    >
                      {ocrError}
                    </div>
                  )}
                </div>
              )}

              {tab === 'manual' && (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
                    הזן ידנית. שדה שם הוא היחיד החובה.
                  </p>
                  {manualRows.map((r, i) => (
                    <ManualRowEditor
                      key={i}
                      row={r}
                      onChange={(patch) => updateManualRow(i, patch)}
                      onRemove={
                        manualRows.length > 1 ? () => removeManualRow(i) : undefined
                      }
                    />
                  ))}
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <button type="button" className="ghost" onClick={addManualRow}>
                      + שורה
                    </button>
                    <button
                      type="button"
                      onClick={onManualSubmit}
                      disabled={!manualRows.some((r) => r.name.trim().length > 0)}
                    >
                      תצוגה מקדימה ←
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {phase === 'preview' && (
          <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
            {rows.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>
                לא זוהו שורות תקינות. חזור וערוך את הקלט.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map((r, i) => (
                  <li
                    key={r.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 8,
                      padding: 10,
                      borderBottom:
                        '1px solid var(--border, rgba(255,255,255,0.08))',
                      alignItems: 'start',
                    }}
                  >
                    <div>
                      <input
                        dir="auto"
                        value={r.name}
                        onChange={(e) => editRow(i, { name: e.target.value })}
                        aria-label={`שם — שורה ${i + 1}`}
                        style={{ width: '100%', fontWeight: 600, fontSize: 14 }}
                      />
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginTop: 6,
                          flexWrap: 'wrap',
                          fontSize: 12,
                          color: 'var(--muted)',
                        }}
                      >
                        <span>{r.tz ?? 'ללא ת.ז.'}</span>
                        <span>·</span>
                        <span>גיל {r.age ?? '—'}</span>
                        <span>·</span>
                        <span>
                          חדר {r.room ?? '—'}
                          {r.bed ? `-${r.bed}` : ''}
                        </span>
                        {r.dxShort && (
                          <>
                            <span>·</span>
                            <span dir="auto" style={{ flex: '0 1 auto' }}>
                              {r.dxShort}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => dropRow(i)}
                      aria-label={`הסר שורה ${i + 1}`}
                      style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <footer
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: 12,
            borderTop: '1px solid var(--border, rgba(255,255,255,0.08))',
          }}
        >
          {phase === 'preview' && (
            <button
              type="button"
              className="ghost"
              onClick={() => setPhase('input')}
            >
              ← חזרה
            </button>
          )}
          <button type="button" className="ghost" onClick={close}>
            ביטול
          </button>
          {phase === 'preview' && (
            <button type="button" onClick={commit} disabled={rows.length === 0}>
              ייבא ({rows.length})
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Manual row editor (small inline component) ──────────────────────

interface ManualRowEditorProps {
  row: ManualRow;
  onChange: (patch: Partial<ManualRow>) => void;
  onRemove?: () => void;
}

function ManualRowEditor({ row, onChange, onRemove }: ManualRowEditorProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 2fr auto',
        gap: 6,
        marginBottom: 6,
        alignItems: 'center',
      }}
    >
      <input
        dir="auto"
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="שם מטופל"
        aria-label="שם"
      />
      <input
        dir="ltr"
        value={row.tz ?? ''}
        onChange={(e) => onChange({ tz: e.target.value || null })}
        placeholder="ת.ז."
        aria-label="ת.ז."
      />
      <input
        type="number"
        inputMode="numeric"
        value={row.age ?? ''}
        onChange={(e) =>
          onChange({ age: e.target.value ? Number(e.target.value) : null })
        }
        placeholder="גיל"
        aria-label="גיל"
      />
      <select
        value={row.sex ?? ''}
        onChange={(e) =>
          onChange({ sex: (e.target.value || null) as 'M' | 'F' | null })
        }
        aria-label="מין"
      >
        <option value="">—</option>
        <option value="M">ז</option>
        <option value="F">נ</option>
      </select>
      <input
        dir="ltr"
        value={row.room ?? ''}
        onChange={(e) => onChange({ room: e.target.value || null })}
        placeholder="חדר"
        aria-label="חדר"
      />
      <input
        dir="ltr"
        value={row.bed ?? ''}
        onChange={(e) => onChange({ bed: e.target.value || null })}
        placeholder="מיטה"
        aria-label="מיטה"
      />
      <input
        dir="auto"
        value={row.dxShort ?? ''}
        onChange={(e) => onChange({ dxShort: e.target.value || null })}
        placeholder="אבחנה ראשית"
        aria-label="אבחנה"
      />
      {onRemove && (
        <button
          type="button"
          className="ghost"
          onClick={onRemove}
          aria-label="הסר שורה"
          style={{ minHeight: 32, padding: '4px 8px' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
