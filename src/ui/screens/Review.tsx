import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listShots, getPastedText } from '@/camera/session';
import { getClient } from '@/agent/client';
import { runExtractTurn } from '@/agent/loop';
import { loadSkills } from '@/skills/loader';
import type { ParseResult, ParseFields, Med } from '@/agent/tools';
import { FieldRow } from '../components/FieldRow';
import { resolveContinuity, type ContinuityContext } from '@/notes/continuity';
import { ContinuityBanner } from '../components/ContinuityBanner';

type Status = 'loading' | 'ready' | 'error';

export function Review() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fields, setFields] = useState<ParseFields>({});
  const [continuity, setContinuity] = useState<ContinuityContext | null>(null);
  const [continuityEnabled, setContinuityEnabled] = useState<boolean>(true);
  const isSoap = sessionStorage.getItem('noteType') === 'soap';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const images = listShots().map((s) => s.dataUrl);
        const pasted = getPastedText();
        if (images.length === 0 && !pasted) throw new Error('אין קלט לעיבוד');
        const client = await getClient();
        const skillContent = await loadSkills(['azma-ui', 'hebrew-medical-glossary']);
        // paste-text mode: embed paste as a text block prefixed to the extraction request
        const imagePayload = images.length > 0 ? images : [];
        const result = await runExtractTurn(client, imagePayload, skillContent + (pasted ? `\n\n## Pasted AZMA text\n${pasted}` : ''));
        if (cancelled) return;
        setParsed(result);
        setFields(result.fields);
        setStatus('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        setError((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        <p>מנתח את המסך...</p>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section>
        <h1>שגיאה</h1>
        <p style={{ color: 'var(--red)' }}>{error}</p>
        <button className="ghost" onClick={() => nav('/')}>חזרה</button>
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
    if (isSoap && continuity?.patient && continuityEnabled) {
      sessionStorage.setItem('continuityTeudatZehut', continuity.patient.teudatZehut);
    } else {
      sessionStorage.removeItem('continuityTeudatZehut');
    }
    nav('/edit');
  }

  return (
    <section>
      <h1>בדיקה</h1>

      {isSoap && continuity && (
        <ContinuityBanner
          ctx={continuity}
          enabled={continuityEnabled}
          onToggle={onToggleContinuity}
        />
      )}

      <FieldRow
        label="שם"
        value={fields.name ?? ''}
        confidence={parsed.confidence['name']}
        sourceRegion={parsed.sourceRegions['name']}
        onChange={update('name')}
        critical
      />
      <FieldRow
        label="ת.ז."
        value={fields.teudatZehut ?? ''}
        confidence={parsed.confidence['teudatZehut']}
        sourceRegion={parsed.sourceRegions['teudatZehut']}
        onChange={update('teudatZehut')}
        critical
      />
      <FieldRow
        label="גיל"
        value={String(fields.age ?? '')}
        confidence={parsed.confidence['age']}
        sourceRegion={parsed.sourceRegions['age']}
        onChange={update('age')}
        critical
      />
      <FieldRow
        label="חדר"
        value={fields.room ?? ''}
        confidence={parsed.confidence['room']}
        sourceRegion={parsed.sourceRegions['room']}
        onChange={update('room')}
      />
      <FieldRow
        label="תלונה ראשית"
        value={fields.chiefComplaint ?? ''}
        confidence={parsed.confidence['chiefComplaint']}
        sourceRegion={parsed.sourceRegions['chiefComplaint']}
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

      <div style={{ marginTop: 16 }}>
        <button onClick={onProceed}>צור טיוטת רשימה ←</button>
      </div>
    </section>
  );
}
