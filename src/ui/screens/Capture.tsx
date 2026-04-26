import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  addImageBlock,
  addTextBlock,
  updateTextBlock,
  removeBlock,
  reorderBlocks,
  listBlocks,
  clearBlocks,
  IMAGE_HARD_CAP as SESSION_IMAGE_HARD_CAP,
  type CaptureBlock,
  type ImageSource,
  type TextSource,
} from '@/camera/session';
import { compressImage } from '@/camera/compress';
import { startSession as startCostSession } from '@/agent/costs';
import { hasApiKey } from '@/crypto/keystore';
import type { NoteType } from '@/storage/indexed';

const NOTE_TYPES: { type: NoteType; label: string }[] = [
  { type: 'admission', label: 'קבלה' },
  { type: 'discharge', label: 'שחרור' },
  { type: 'consult', label: 'ייעוץ' },
  { type: 'case', label: 'מקרה מעניין' },
  { type: 'soap', label: 'SOAP יומי' },
];

export const IMAGE_SOFT_CAP = 6;
export const IMAGE_HARD_CAP = SESSION_IMAGE_HARD_CAP;

const IMAGE_SOURCE_LABEL: Record<ImageSource, string> = {
  camera: 'מצלמה',
  gallery: 'גלריה',
  clipboard: 'מהלוח',
};
const TEXT_SOURCE_LABEL: Record<TextSource, string> = {
  typed: 'הוקלד',
  paste: 'מודבק',
};

const TEXT_PREVIEW_CHARS = 120;

export function Capture() {
  const nav = useNavigate();
  const [noteType, setNoteType] = useState<NoteType>('admission');
  const [blocks, setBlocks] = useState<readonly CaptureBlock[]>(listBlocks());
  const [pickWarn, setPickWarn] = useState('');
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [showAddText, setShowAddText] = useState(false);
  const [addTextDraft, setAddTextDraft] = useState('');

  const refresh = () => setBlocks([...listBlocks()]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const seeded = sessionStorage.getItem('continuityNoteType');
    if (seeded === 'soap') {
      setNoteType('soap');
      sessionStorage.removeItem('continuityNoteType');
    }
    startCostSession();
    hasApiKey().then(setKeyPresent);
  }, []);

  // Window-level paste handler: works regardless of focus on the Capture
  // screen. Image items become image blocks with sourceLabel='clipboard';
  // plain text becomes a text block with sourceLabel='paste'. If clipboard
  // contains both (e.g. a screenshot copied alongside a caption), both are
  // added. We do NOT auto-navigate to /review — the user still hits Proceed.
  useEffect(() => {
    async function handlePaste(e: ClipboardEvent) {
      const cd = e.clipboardData;
      if (!cd) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(cd.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      const textPayload = cd.getData('text');
      if (imageFiles.length === 0 && !textPayload) return;
      e.preventDefault();
      if (imageFiles.length > 0) {
        const dataUrls = await Promise.all(imageFiles.map(readAsDataUrl));
        const compressed = await Promise.all(dataUrls.map((d) => compressImage(d)));
        let dropped = 0;
        for (const d of compressed) {
          const added = addImageBlock(d, 'clipboard');
          if (!added) dropped++;
        }
        if (dropped > 0) {
          setPickWarn(`הגעת לתקרה של ${IMAGE_HARD_CAP} תמונות. ${dropped} לא נוספו.`);
        }
      }
      if (textPayload && textPayload.trim().length > 0) {
        addTextBlock(textPayload, 'paste');
      }
      refreshRef.current();
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>, source: ImageSource) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const current = listBlocks().filter((b) => b.kind === 'image').length;
    const remaining = IMAGE_HARD_CAP - current;
    if (remaining <= 0) {
      setPickWarn(`הגעת לתקרה של ${IMAGE_HARD_CAP} תמונות.`);
      e.target.value = '';
      return;
    }
    const toAdd = Array.from(files).slice(0, remaining);
    const dropped = files.length - toAdd.length;
    if (dropped > 0) {
      setPickWarn(`הגעת לתקרה של ${IMAGE_HARD_CAP} תמונות. ${dropped} לא נוספו.`);
    } else {
      setPickWarn('');
    }
    const dataUrls = await Promise.all(toAdd.map(readAsDataUrl));
    const compressed = await Promise.all(dataUrls.map((d) => compressImage(d)));
    for (const d of compressed) addImageBlock(d, source);
    refresh();
    e.target.value = '';
  }

  function onCommitAddText() {
    const v = addTextDraft.trim();
    if (!v) {
      setShowAddText(false);
      setAddTextDraft('');
      return;
    }
    const added = addTextBlock(addTextDraft, 'typed');
    if (!added) {
      setPickWarn('הגעת לתקרת בלוקי טקסט.');
    }
    setAddTextDraft('');
    setShowAddText(false);
    refresh();
  }

  function onStartEdit(b: CaptureBlock) {
    if (b.kind !== 'text') return;
    setEditingId(b.id);
    setEditingDraft(b.content);
  }

  function onCommitEdit() {
    if (!editingId) return;
    updateTextBlock(editingId, editingDraft);
    setEditingId(null);
    setEditingDraft('');
    refresh();
  }

  function onRemove(id: string) {
    removeBlock(id);
    if (editingId === id) {
      setEditingId(null);
      setEditingDraft('');
    }
    refresh();
  }

  function onMove(idx: number, delta: number) {
    reorderBlocks(idx, idx + delta);
    refresh();
  }

  function onProceed() {
    if (blocks.length === 0) return;
    sessionStorage.setItem('noteType', noteType);
    nav('/review');
  }

  function onReset() {
    clearBlocks();
    setBlocks([]);
    setPickWarn('');
    setShowAddText(false);
    setAddTextDraft('');
    setEditingId(null);
    setEditingDraft('');
  }

  const imageCount = blocks.filter((b) => b.kind === 'image').length;
  const pillClass =
    imageCount <= IMAGE_SOFT_CAP
      ? 'pill pill-info'
      : imageCount < IMAGE_HARD_CAP
        ? 'pill pill-warn'
        : 'pill pill-err';
  const pillText =
    imageCount <= IMAGE_SOFT_CAP
      ? `${imageCount} תמונות`
      : imageCount < IMAGE_HARD_CAP
        ? `${imageCount} תמונות — אטי יותר, אך פעיל`
        : `${imageCount}/${IMAGE_HARD_CAP} — תקרה`;

  return (
    <section>
      <h1>צלם מסך</h1>

      {keyPresent === false && (
        <div
          style={{
            background: 'var(--warn)',
            color: 'black',
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 14,
            lineHeight: 1.45,
          }}
          role="alert"
        >
          <strong>אין מפתח API.</strong>{' '}
          הפרוקסי הציבורי עוצר אחרי 10 שניות ונפסק על רישומים ארוכים.{' '}
          <Link
            to="/settings"
            style={{ color: 'black', fontWeight: 600, textDecoration: 'underline' }}
          >
            הגדר מפתח ←
          </Link>
        </div>
      )}

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

      {imageCount > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span className={pillClass}>{pillText}</span>
        </div>
      )}

      {pickWarn && (
        <div className="pill pill-warn" style={{ marginBlock: 4 }}>
          {pickWarn}
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📥</div>
          <p className="empty-title">אין קלט. הוסף תמונה, צילום מסך או טקסט למטה.</p>
        </div>
      ) : (
        <ol
          aria-label="block-list"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {blocks.map((b, i) => {
            const isFirst = i === 0;
            const isLast = i === blocks.length - 1;
            return (
              <li
                key={b.id}
                data-block-kind={b.kind}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  padding: 8,
                  border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  borderRadius: 8,
                  background: 'var(--card)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <button
                    type="button"
                    className="ghost"
                    aria-label="העלה למעלה"
                    disabled={isFirst}
                    onClick={() => onMove(i, -1)}
                    style={{ minHeight: 32, padding: '4px 8px' }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="הורד למטה"
                    disabled={isLast}
                    onClick={() => onMove(i, 1)}
                    style={{ minHeight: 32, padding: '4px 8px' }}
                  >
                    ↓
                  </button>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {b.kind === 'image' ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <img
                        src={b.blobUrl}
                        alt="block"
                        style={{
                          width: 140,
                          height: 140,
                          objectFit: 'cover',
                          borderRadius: 6,
                          flexShrink: 0,
                        }}
                      />
                      <span className="pill pill-info" style={{ alignSelf: 'flex-start' }}>
                        {IMAGE_SOURCE_LABEL[b.sourceLabel]}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span
                        className="pill pill-info"
                        style={{ display: 'inline-block', marginBottom: 6 }}
                      >
                        {TEXT_SOURCE_LABEL[b.sourceLabel]}
                      </span>
                      {editingId === b.id ? (
                        <>
                          <textarea
                            dir="auto"
                            rows={6}
                            value={editingDraft}
                            onChange={(e) => setEditingDraft(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button type="button" onClick={onCommitEdit}>
                              סיים
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setEditingDraft('');
                              }}
                            >
                              ביטול
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p
                            dir="auto"
                            style={{
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: 13,
                              lineHeight: 1.4,
                            }}
                          >
                            {previewText(b.content)}
                          </p>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onStartEdit(b)}
                            style={{ marginTop: 4, padding: '4px 10px', minHeight: 32 }}
                          >
                            ערוך
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="ghost"
                  aria-label="הסר בלוק"
                  onClick={() => onRemove(b.id)}
                  style={{ padding: '4px 10px', minHeight: 32 }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 16,
          paddingBlock: 8,
          position: 'sticky',
          bottom: 0,
          background: 'var(--bg, transparent)',
        }}
      >
        {/*
          Label-wrapped inputs are required on mobile Chrome — programmatic
          .click() on display:none inputs fails silently in PWA standalone
          mode. Tapping a <label> dispatches a trusted click directly.
        */}
        <label className="btn-like" aria-label="צלם">
          📷 צלם
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => onPickFiles(e, 'camera')}
          />
        </label>
        <label className="btn-like ghost" aria-label="בחר מהגלריה">
          🖼️ גלריה
          <input
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            onChange={(e) => onPickFiles(e, 'gallery')}
          />
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowAddText((v) => !v)}
        >
          📝 הוסף טקסט
        </button>
      </div>

      {showAddText && (
        <div style={{ marginTop: 8 }}>
          <textarea
            dir="auto"
            rows={6}
            placeholder="הקלד טקסט AZMA / רקע / הערות..."
            value={addTextDraft}
            onChange={(e) => setAddTextDraft(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" onClick={onCommitAddText}>
              הוסף
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowAddText(false);
                setAddTextDraft('');
              }}
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onProceed} disabled={blocks.length === 0}>
          המשך לבדיקה ←
        </button>
        <button className="ghost" onClick={onReset}>
          נקה
        </button>
      </div>
    </section>
  );
}

function previewText(s: string): string {
  if (s.length <= TEXT_PREVIEW_CHARS) return s;
  return s.slice(0, TEXT_PREVIEW_CHARS).trimEnd() + '…';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
