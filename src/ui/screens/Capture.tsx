import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addShot,
  listShots,
  clearShots,
  setPastedText,
  getPastedText,
  type Shot,
} from '@/camera/session';
import type { NoteType } from '@/storage/indexed';

const NOTE_TYPES: { type: NoteType; label: string }[] = [
  { type: 'admission', label: 'קבלה' },
  { type: 'discharge', label: 'שחרור' },
  { type: 'consult', label: 'ייעוץ' },
  { type: 'case', label: 'מקרה מעניין' },
  { type: 'soap', label: 'SOAP יומי' },
];

type Mode = 'camera' | 'paste';

export function Capture() {
  const nav = useNavigate();
  const [noteType, setNoteType] = useState<NoteType>('admission');
  const [mode, setMode] = useState<Mode>('camera');
  const [shots, setShots] = useState<readonly Shot[]>(listShots());
  const [paste, setPaste] = useState<string>(getPastedText() ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const seeded = sessionStorage.getItem('continuityNoteType');
    if (seeded === 'soap') {
      setNoteType('soap');
      sessionStorage.removeItem('continuityNoteType');
    }
  }, []);

  async function onCapture(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(f);
    });
    addShot(dataUrl);
    setShots([...listShots()]);
    e.target.value = '';
  }

  function onPasteChange(v: string) {
    setPaste(v);
    setPastedText(v.length > 0 ? v : null);
  }

  function canProceed(): boolean {
    return mode === 'camera' ? shots.length > 0 : paste.trim().length > 0;
  }

  function onProceed() {
    if (!canProceed()) return;
    sessionStorage.setItem('noteType', noteType);
    nav('/review');
  }

  function onReset() {
    clearShots();
    setShots([]);
    setPaste('');
  }

  return (
    <section>
      <h1>צלם מסך</h1>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {NOTE_TYPES.map((t) => (
          <button
            key={t.type}
            className={noteType === t.type ? '' : 'ghost'}
            onClick={() => setNoteType(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={mode === 'camera' ? '' : 'ghost'} onClick={() => setMode('camera')}>
          📷 מצלמה
        </button>
        <button className={mode === 'paste' ? '' : 'ghost'} onClick={() => setMode('paste')}>
          📋 הדבק
        </button>
      </div>

      {mode === 'camera' ? (
        <>
          <button onClick={() => fileRef.current?.click()}>📷 צלם AZMA</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={onCapture}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              marginTop: 16,
            }}
          >
            {shots.map((s) => (
              <img key={s.id} src={s.blobUrl} style={{ width: '100%', borderRadius: 8 }} alt="shot" />
            ))}
          </div>
        </>
      ) : (
        <textarea
          dir="auto"
          rows={10}
          placeholder="הדבק טקסט AZMA כאן..."
          value={paste}
          onChange={(e) => onPasteChange(e.target.value)}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onProceed} disabled={!canProceed()}>
          המשך לבדיקה ←
        </button>
        <button className="ghost" onClick={onReset}>
          נקה
        </button>
      </div>
    </section>
  );
}
