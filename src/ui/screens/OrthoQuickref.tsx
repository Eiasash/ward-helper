// src/ui/screens/OrthoQuickref.tsx
//
// Ortho-rehab quickref screen. Three sections:
//   A. Live calculators (POD, suture removal, DVT prophylaxis)
//   B. Reference cards (collapsible accordion, native <details>)
//   C. SOAP templates (collapsible, copy-to-Chameleon button each)
//
// All clipboard writes go through wrapForChameleon (sanitizes arrows,
// bold markers, dashes, gt/lt-N etc. - the Chameleon EMR boundary contract).
//
// Inherits styles from src/styles.css (.card, .btn-like, .toggle-row,
// .empty). No new component CSS introduced.

import { useMemo, useState } from 'react';
import {
  calculatePOD,
  suggestSutureRemovalDate,
  suggestDvtProphylaxis,
  type SutureSiteKey,
  type SutureModifiersInput,
  type DvtRenalState,
} from '@/notes/orthoCalc';
import { ORTHO_REFERENCE } from '@/data/orthoReference';
import { ORTHO_TEMPLATES } from '@/data/orthoTemplates';
import { wrapForChameleon } from '@/i18n/bidi';

const SITE_OPTIONS: ReadonlyArray<{ key: SutureSiteKey; label: string }> = [
  { key: 'face', label: 'פנים / צוואר' },
  { key: 'scalp', label: 'קרקפת' },
  { key: 'trunk', label: 'גו / בטן' },
  { key: 'hip', label: 'ירך / גפה פרוקסימלית' },
  { key: 'spine', label: 'עמוד שדרה' },
  { key: 'knee', label: 'ברך / מתחת' },
  { key: 'foot', label: 'כף רגל' },
];

const RENAL_OPTIONS: ReadonlyArray<{ key: DvtRenalState; label: string }> = [
  { key: 'normal', label: 'תקין' },
  { key: 'crclLow', label: 'CrCl נמוך מ-30' },
  { key: 'hd', label: 'המודיאליזה' },
  { key: 'bleedingRisk', label: 'סיכון דימום / contraindication ל-LMWH' },
];

const MODIFIER_OPTIONS: ReadonlyArray<{
  key: keyof SutureModifiersInput;
  label: string;
}> = [
  { key: 'steroids', label: 'סטרואידים / immunosuppression (+5d)' },
  { key: 'dmUncontrolled', label: 'סוכרת לא מאוזנת A1c מעל 8 (+5d)' },
  { key: 'malnutrition', label: 'תת-תזונה אלבומין מתחת 3 (+4d)' },
  { key: 'smoker', label: 'מעשן / מחלת כלי דם (+3d)' },
  { key: 'woundUnderTension', label: 'פצע במתח (+3d)' },
  { key: 'infectionSigns', label: 'סימני זיהום (+7d, ייעוץ אורתו)' },
];

function formatDDMMYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !m[1] || !m[2] || !m[3]) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
}

async function copyToChameleon(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(wrapForChameleon(text));
    return true;
  } catch {
    return false;
  }
}

export default function OrthoQuickref() {
  const [surgeryDate, setSurgeryDate] = useState<string>('');
  const [site, setSite] = useState<SutureSiteKey>('hip');
  const [modifiers, setModifiers] = useState<SutureModifiersInput>({});
  const [renalState, setRenalState] = useState<DvtRenalState>('normal');
  const [copyMsg, setCopyMsg] = useState<string>('');

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(surgeryDate);

  const pod = useMemo(
    () => (validDate ? calculatePOD(surgeryDate) : null),
    [surgeryDate, validDate],
  );

  const suture = useMemo(
    () => (validDate ? suggestSutureRemovalDate(surgeryDate, site, modifiers) : null),
    [surgeryDate, site, modifiers, validDate],
  );

  const dvt = useMemo(
    () => (validDate ? suggestDvtProphylaxis(surgeryDate, renalState) : null),
    [surgeryDate, renalState, validDate],
  );

  function toggleModifier(key: keyof SutureModifiersInput) {
    setModifiers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleCopyDvt() {
    if (!dvt) return;
    const ok = await copyToChameleon(dvt.hebrewLine);
    setCopyMsg(ok ? 'הועתק' : 'נכשל');
    setTimeout(() => setCopyMsg(''), 2000);
  }

  async function handleCopyTemplate(text: string) {
    const ok = await copyToChameleon(text);
    setCopyMsg(ok ? 'תבנית הועתקה' : 'העתקה נכשלה');
    setTimeout(() => setCopyMsg(''), 2000);
  }

  return (
    <section>
      <h1>אורתו - מדריך מהיר</h1>

      {/* ─── Section A: Calculators ─── */}
      <div className="card" style={{ marginBlock: 12 }}>
        <h2 style={{ marginTop: 0 }}>מחשבונים</h2>

        <label style={{ display: 'block', marginBlock: 8 }}>
          <div>תאריך ניתוח</div>
          <input
            type="date"
            value={surgeryDate}
            onChange={(e) => setSurgeryDate(e.target.value)}
            aria-label="תאריך ניתוח"
            style={{ font: 'inherit', padding: 6 }}
          />
        </label>

        {!validDate && (
          <p className="empty-sub" style={{ marginBlock: 4 }}>
            בחר תאריך ניתוח כדי להציג POD, תאריך הוצאת סיכות ופרופילקסיס DVT.
          </p>
        )}

        {validDate && pod !== null && (
          <p style={{ fontWeight: 600, fontSize: '1.1em', marginBlock: 6 }}>
            POD: {pod}
          </p>
        )}

        {/* Suture removal */}
        <fieldset style={{ marginBlock: 12, padding: 8 }}>
          <legend>הוצאת סיכות</legend>
          <label style={{ display: 'block', marginBlock: 6 }}>
            <div>אזור</div>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value as SutureSiteKey)}
              aria-label="אזור פצע"
              style={{ font: 'inherit', padding: 6 }}
            >
              {SITE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="גורמים מאריכים" style={{ marginBlock: 6 }}>
            {MODIFIER_OPTIONS.map((m) => (
              <label key={m.key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={!!modifiers[m.key]}
                  onChange={() => toggleModifier(m.key)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          {suture && (
            <div style={{ marginBlock: 6 }}>
              <p style={{ margin: '4px 0' }}>
                להוצאה תאריך {formatDDMMYY(suture.dateISO)} (POD {suture.podAdjusted})
              </p>
              {suture.modifiersApplied.length > 0 && (
                <ul style={{ margin: '4px 0 0 0', paddingInlineStart: 18 }}>
                  {suture.modifiersApplied.map((m) => (
                    <li key={m} dir="auto">{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </fieldset>

        {/* DVT prophylaxis */}
        <fieldset style={{ marginBlock: 12, padding: 8 }}>
          <legend>פרופילקסיס DVT</legend>
          <div role="radiogroup" aria-label="מצב כלייתי" style={{ marginBlock: 6 }}>
            {RENAL_OPTIONS.map((o) => (
              <label key={o.key} className="toggle-row">
                <input
                  type="radio"
                  name="renalState"
                  value={o.key}
                  checked={renalState === o.key}
                  onChange={() => setRenalState(o.key)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          {dvt && (
            <div style={{ marginBlock: 6 }}>
              <p style={{ margin: '4px 0' }} dir="auto">{dvt.hebrewLine}</p>
              <button
                type="button"
                className="btn-like"
                onClick={handleCopyDvt}
                aria-label="העתק פרופילקסיס DVT"
              >
                העתק
              </button>
            </div>
          )}
        </fieldset>

        {copyMsg && (
          <p className="cloud-banner" role="status" style={{ marginBlock: 6 }}>
            {copyMsg}
          </p>
        )}
      </div>

      {/* ─── Section B: Reference cards ─── */}
      <div className="card" style={{ marginBlock: 12 }}>
        <h2 style={{ marginTop: 0 }}>כרטיסי עזר</h2>

        <details>
          <summary>שברי ירך - בחירת פרוצדורה</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>מיקום</th>
                <th style={{ textAlign: 'right', padding: 4 }}>תת-סוג</th>
                <th style={{ textAlign: 'right', padding: 4 }}>פרוצדורה</th>
                <th style={{ textAlign: 'right', padding: 4 }}>הרציונל</th>
              </tr>
            </thead>
            <tbody>
              {ORTHO_REFERENCE.hipFractureProcedures.map((p, i) => (
                <tr key={i}>
                  <td dir="auto" style={{ padding: 4 }}>{p.fractureLocation}</td>
                  <td dir="auto" style={{ padding: 4 }}>{p.subtype}</td>
                  <td dir="auto" style={{ padding: 4 }}>{p.procedure}</td>
                  <td dir="auto" style={{ padding: 4 }}>{p.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <details>
          <summary>חיתוך תפרים - לפי אזור</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>אזור</th>
                <th style={{ textAlign: 'right', padding: 4 }}>POD</th>
                <th style={{ textAlign: 'right', padding: 4 }}>הערה</th>
              </tr>
            </thead>
            <tbody>
              {ORTHO_REFERENCE.sutureTiming.map((s, i) => (
                <tr key={i}>
                  <td dir="auto" style={{ padding: 4 }}>{s.siteHebrew} ({s.site})</td>
                  <td dir="auto" style={{ padding: 4 }}>
                    {s.podStandard[0] === s.podStandard[1]
                      ? s.podStandard[0]
                      : `${s.podStandard[0]}-${s.podStandard[1]}`}
                  </td>
                  <td dir="auto" style={{ padding: 4 }}>{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginBlock: 8 }}>גורמים מאריכים</h3>
          <ul>
            {ORTHO_REFERENCE.sutureModifiers.prolong.map((m) => (
              <li key={m} dir="auto">{m}</li>
            ))}
          </ul>
          <h3 style={{ marginBlock: 8 }}>פרוטוקול גבול / Steri-Strips</h3>
          <p dir="auto">{ORTHO_REFERENCE.sutureModifiers.borderlineProtocol}</p>
          <p dir="auto">{ORTHO_REFERENCE.sutureModifiers.steriStripPolicy}</p>
          <p dir="auto"><em>{ORTHO_REFERENCE.sutureModifiers.weekendTrap}</em></p>
        </details>

        <details>
          <summary>ASA - דירוג רפואי לפני ניתוח</summary>
          <ul>
            {ORTHO_REFERENCE.asaClasses.map((c) => (
              <li key={c.class} dir="auto">
                <strong>ASA {c.class}</strong>: {c.patient}
              </li>
            ))}
            <li dir="auto"><strong>סיומת E</strong>: {ORTHO_REFERENCE.asaSuffix.E}</li>
          </ul>
          <p dir="auto"><em>{ORTHO_REFERENCE.asaWarning}</em></p>
        </details>

        <details>
          <summary>DVT פרופילקסיס - הצעה ברירת מחדל</summary>
          <p dir="auto">
            <strong>ברירת מחדל</strong>: {ORTHO_REFERENCE.dvtProphylaxisHipPostOp.default.noteHebrew}
          </p>
          <h3 style={{ marginBlock: 8 }}>התאמות כלייתיות</h3>
          <ul>
            {ORTHO_REFERENCE.dvtProphylaxisHipPostOp.renalAdjustments.map((r) => (
              <li key={r.criterion} dir="auto">
                <strong>{r.criterion}</strong>: {r.noteHebrew}
              </li>
            ))}
          </ul>
        </details>

        <details>
          <summary>Vancouver - שבר periprosthetic של עצם הירך</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>סוג</th>
                <th style={{ textAlign: 'right', padding: 4 }}>מיקום</th>
                <th style={{ textAlign: 'right', padding: 4 }}>יציבות גזע</th>
                <th style={{ textAlign: 'right', padding: 4 }}>טיפול</th>
              </tr>
            </thead>
            <tbody>
              {ORTHO_REFERENCE.vancouverPeriprostheticFemur.map((v) => (
                <tr key={v.type}>
                  <td dir="auto" style={{ padding: 4 }}>{v.type}</td>
                  <td dir="auto" style={{ padding: 4 }}>{v.location}</td>
                  <td dir="auto" style={{ padding: 4 }}>{v.stemStability}</td>
                  <td dir="auto" style={{ padding: 4 }}>{v.treatment}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p dir="auto"><em>{ORTHO_REFERENCE.vancouverNote}</em></p>
        </details>

        <details>
          <summary>בדיקות הדמיה לאחר ניתוח</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>סיבה</th>
                <th style={{ textAlign: 'right', padding: 4 }}>תדירות</th>
                <th style={{ textAlign: 'right', padding: 4 }}>טריגר</th>
                <th style={{ textAlign: 'right', padding: 4 }}>הדמיה</th>
                <th style={{ textAlign: 'right', padding: 4 }}>מעבדה</th>
              </tr>
            </thead>
            <tbody>
              {ORTHO_REFERENCE.postOpImagingDifferential.map((d, i) => (
                <tr key={i}>
                  <td dir="auto" style={{ padding: 4 }}>{d.cause}</td>
                  <td dir="auto" style={{ padding: 4 }}>{d.frequency}</td>
                  <td dir="auto" style={{ padding: 4 }}>{d.trigger}</td>
                  <td dir="auto" style={{ padding: 4 }}>{d.imaging}</td>
                  <td dir="auto" style={{ padding: 4 }}>{d.labs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginBlock: 8 }}>טיפים</h3>
          <ul>
            {ORTHO_REFERENCE.imagingPearls.map((p) => (
              <li key={p} dir="auto">{p}</li>
            ))}
          </ul>
          <h3 style={{ marginBlock: 8 }}>כללים ליד המיטה</h3>
          <ul>
            {ORTHO_REFERENCE.bedsideImagingRules.map((r) => (
              <li key={r.scenario} dir="auto">
                <strong>{r.scenario}</strong>: {r.firstMove}
              </li>
            ))}
          </ul>
        </details>

        <details>
          <summary>ORIF vs CRIF</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>קריטריון</th>
                <th style={{ textAlign: 'right', padding: 4 }}>ORIF</th>
                <th style={{ textAlign: 'right', padding: 4 }}>CRIF</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: 4 }}>איחוי</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.reduction}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.reduction}</td>
              </tr>
              <tr>
                <td style={{ padding: 4 }}>חתך</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.incision}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.incision}</td>
              </tr>
              <tr>
                <td style={{ padding: 4 }}>הדמיה</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.visualization}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.visualization}</td>
              </tr>
              <tr>
                <td style={{ padding: 4 }}>נזק לרקמה רכה</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.softTissueDamage}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.softTissueDamage}</td>
              </tr>
              <tr>
                <td style={{ padding: 4 }}>סיכון זיהום</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.infectionRisk}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.infectionRisk}</td>
              </tr>
              <tr>
                <td style={{ padding: 4 }}>אינדיקציה</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.ORIF.indication}</td>
                <td dir="auto" style={{ padding: 4 }}>{ORTHO_REFERENCE.orifVsCrif.CRIF.indication}</td>
              </tr>
            </tbody>
          </table>
          <h3 style={{ marginBlock: 8 }}>דוגמאות</h3>
          <ul>
            {ORTHO_REFERENCE.orifVsCrif.examples.map((e) => {
              const note = 'note' in e ? e.note : undefined;
              return (
                <li key={e.procedure} dir="auto">
                  <strong>{e.procedure}</strong> - {e.category}
                  {note ? ` (${note})` : ''}
                </li>
              );
            })}
          </ul>
          <p dir="auto"><em>{ORTHO_REFERENCE.orifVsCrif.rehabImplication}</em></p>
        </details>

        <details>
          <summary>IM nails - מותגים</summary>
          <table dir="rtl" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: 4 }}>מותג</th>
                <th style={{ textAlign: 'right', padding: 4 }}>יצרן</th>
                <th style={{ textAlign: 'right', padding: 4 }}>Lag screw</th>
                <th style={{ textAlign: 'right', padding: 4 }}>הערה</th>
              </tr>
            </thead>
            <tbody>
              {ORTHO_REFERENCE.imNailBrands.map((n) => (
                <tr key={n.brand}>
                  <td dir="auto" style={{ padding: 4 }}>{n.brand}</td>
                  <td dir="auto" style={{ padding: 4 }}>{n.manufacturer}</td>
                  <td dir="auto" style={{ padding: 4 }}>{n.lagScrew}</td>
                  <td dir="auto" style={{ padding: 4 }}>{n.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p dir="auto"><em>{ORTHO_REFERENCE.imNailNote}</em></p>
        </details>
      </div>

      {/* ─── Section C: SOAP templates ─── */}
      <div className="card" style={{ marginBlock: 12 }}>
        <h2 style={{ marginTop: 0 }}>תבניות SOAP</h2>

        {([
          ['day1OrthoCapsule', ORTHO_TEMPLATES.day1OrthoCapsule],
          ['day1SoapPostHip', ORTHO_TEMPLATES.day1SoapPostHip],
          ['day1SoapPostSpine', ORTHO_TEMPLATES.day1SoapPostSpine],
          ['dailyStableGym', ORTHO_TEMPLATES.dailyStableGym],
          ['dailyStableBedside', ORTHO_TEMPLATES.dailyStableBedside],
        ] as const).map(([key, t]) => {
          // A template can either have a single `template` field or four
          // S/O/A/P fields. Concatenate the four into one paste-ready string
          // for the copy button + display.
          const body =
            'template' in t && t.template
              ? t.template
              : [
                  'templateS' in t ? t.templateS : '',
                  'templateO' in t ? t.templateO : '',
                  'templateA' in t ? t.templateA : '',
                  'templateP' in t ? t.templateP : '',
                ]
                  .filter(Boolean)
                  .join('\n\n');
          return (
            <details key={key}>
              <summary dir="auto">{t.label}</summary>
              <pre
                dir="auto"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--surface-3)',
                  padding: 8,
                  borderRadius: 4,
                  font: 'inherit',
                  fontSize: '0.95em',
                }}
              >
                {body}
              </pre>
              <button
                type="button"
                className="btn-like"
                onClick={() => handleCopyTemplate(body)}
                aria-label={`העתק תבנית ${t.label}`}
              >
                העתק
              </button>
            </details>
          );
        })}

        <h3 style={{ marginBlock: 8 }}>קידומות תחום (Domain prefixes)</h3>
        <ul>
          {Object.entries(ORTHO_TEMPLATES.domainPrefixes).map(([prefix, desc]) => (
            <li key={prefix} dir="auto">
              <strong dir="auto">{prefix}</strong>: {desc}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
