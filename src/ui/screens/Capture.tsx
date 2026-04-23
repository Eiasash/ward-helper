import { useState, useEffect, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addShot,
  listShots,
  clearShots,
  removeShot,
  setPastedText,
  getPastedText,
  type Shot,
} from '@/camera/session';
import { compressImage } from '@/camera/compress';
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

  useEffect(() => {
    const seeded = sessionStorage.getItem('continuityNoteType');
    if (seeded === 'soap') {
      setNoteType('soap');
      sessionStorage.removeItem('continuityNoteType');
    }
  }, []);

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Handle all selected files: 1 from camera OR N from gallery multi-select.
    const readers = Array.from(files).map(
      (f) =>
        new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(f);
        }),
    );
    const dataUrls = await Promise.all(readers);
    // Downsize before storing — cuts upload size ~20x and avoids mobile
    // Chrome stalling on multi-MB POSTs to the Claude proxy.
    const compressed = await Promise.all(dataUrls.map(compressImage));
    for (const d of compressed) addShot(d);
    setShots([...listShots()]);
    // Reset so the same file can be picked again if user wants.
    e.target.value = '';
  }

  function onPasteChange(v: string) {
    setPaste(v);
    setPastedText(v.length > 0 ? v : null);
  }

  function onDeleteShot(id: string) {
    removeShot(id);
    setShots([...listShots()]);
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/*
              Label-wrapped inputs are the reliable pattern on mobile Chrome.
              Programmatic .click() on display:none inputs is flaky in PWA/standalone mode
              because the browser's user-activation check can reject the synthesized click.
              Tapping a <label> dispatches a trusted click to the input directly.
            */}
            <label className="btn-like" aria-label="צלם AZMA">
              📷 צלם AZMA
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={onPickFiles}
              />
            </label>
            <label className="btn-like ghost" aria-label="בחר מהגלריה">
              🖼️ מהגלריה
              <input
                type="file"
                accept="image/*"
                multiple
                className="visually-hidden"
                onChange={onPickFiles}
              />
            </label>
            {shots.length > 0 && (
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>
                {shots.length} תמונות
              </span>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              marginTop: 16,
            }}
          >
            {shots.map((s) => (
              <div key={s.id} className="shot-thumb">
                <img src={s.blobUrl} alt="shot" />
                <button
                  type="button"
                  className="shot-delete"
                  aria-label="הסר תמונה"
                  onClick={() => onDeleteShot(s.id)}
                >
                  ✕
                </button>
              </div>
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
