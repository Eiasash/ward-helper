import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { runBatchSoap, type BatchProgressEvent, type BatchResult, type BatchStatus } from '@/notes/batchSoap';
import { compressImage } from '@/camera/compress';
import type { CaptureBlock } from '@/camera/session';
import type { RosterPatient } from '@/storage/roster';
import type { SoapMode } from '@/notes/soapMode';

/**
 * Phase E batch flow — Phase D+E v1.38.0, commit 4.
 *
 * State machine:
 *   collecting → running → summary (→ onClose)
 *
 * collecting: per-patient image picker. Doctor takes 1+ clinical photos
 *   per patient (vitals strip, problem list, labs — NOT the patient card,
 *   identity comes from RosterPatient). [Next] advances; on the last
 *   patient, [Run] transitions to running.
 *
 * running: kicks off runBatchSoap with the collected images + an
 *   AbortController. onProgress events drive the per-patient status
 *   strip. [בטל] fires controller.abort(). When the driver promise
 *   resolves, transitions to summary.
 *
 * summary: per-patient outcome list. Tap a completed row to view the
 *   note. [סיום] closes back to the roster view via onClose.
 *
 * Self-contained. Mounts inside Today.tsx as a render-branch (not a
 * route) so the bottom-nav remains visible — if the doctor navigates
 * away mid-batch, the async runBatchSoap keeps running in the
 * background and saves notes via saveBoth as each patient completes.
 * Returning to /today after navigating away will remount this
 * component with cleared state (the batch UI is lost) but the saved
 * notes are intact in History. That's the MVP UX; a navigation guard
 * during running phase is a follow-up if doctors hit this in practice.
 */

export interface BatchFlowProps {
  patients: ReadonlyArray<RosterPatient>;
  onClose: () => void;
  soapMode?: SoapMode;
}

type Phase = 'collecting' | 'running' | 'summary';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(file);
  });
}

export function BatchFlow({ patients, onClose, soapMode }: BatchFlowProps) {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>('collecting');
  const [imagesPerPatient, setImagesPerPatient] = useState<CaptureBlock[][]>(
    () => patients.map(() => []),
  );
  const [currentPatient, setCurrentPatient] = useState(0);
  const [progressByIdx, setProgressByIdx] = useState<Map<number, BatchProgressEvent>>(
    () => new Map(),
  );
  const [result, setResult] = useState<BatchResult | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const [compressing, setCompressing] = useState(false);

  // Run the batch when we transition to 'running'. Single-shot effect —
  // the dep array fires once on phase change, the async IIFE handles
  // the rest.
  useEffect(() => {
    if (phase !== 'running') return;
    abortCtrlRef.current = new AbortController();
    const signal = abortCtrlRef.current.signal;
    let cancelled = false;
    (async () => {
      const r = await runBatchSoap(patients, {
        images: imagesPerPatient,
        soapMode: soapMode ?? 'general',
        abortSignal: signal,
        onProgress: (ev) => {
          if (cancelled) return;
          setProgressByIdx((prev) => {
            const next = new Map(prev);
            next.set(ev.index, ev);
            return next;
          });
        },
      });
      if (cancelled) return;
      setResult(r);
      setPhase('summary');
    })();
    return () => {
      cancelled = true;
    };
    // patients/images/soapMode are captured at phase-transition time;
    // changing them during 'running' is not a supported state and would
    // require restarting the batch — a UI we don't have. The eslint
    // exhaustive-deps warning here would be misleading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function onPickImagesForCurrent(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setCompressing(true);
    try {
      const arr = Array.from(files);
      const dataUrls = await Promise.all(arr.map(readAsDataUrl));
      const compressed = await Promise.all(dataUrls.map((d) => compressImage(d)));
      const blocks: CaptureBlock[] = compressed.map((dataUrl, i) => ({
        id: crypto.randomUUID(),
        kind: 'image' as const,
        dataUrl,
        // blobUrl is required by the type but we don't render previews;
        // create a no-op blob URL from a tiny stub. Capture.tsx uses
        // proper blob URLs because it renders thumbnails — batch flow
        // doesn't render the captured images, just the count.
        blobUrl: `blob:batch-${i}`,
        sourceLabel: 'camera' as const,
        addedAt: Date.now(),
      }));
      setImagesPerPatient((prev) => {
        const next = [...prev];
        next[currentPatient] = [...(next[currentPatient] ?? []), ...blocks];
        return next;
      });
    } finally {
      setCompressing(false);
      e.target.value = '';
    }
  }

  function removeImage(patientIdx: number, blockId: string) {
    setImagesPerPatient((prev) => {
      const next = [...prev];
      next[patientIdx] = (next[patientIdx] ?? []).filter((b) => b.id !== blockId);
      return next;
    });
  }

  function advance() {
    if (currentPatient < patients.length - 1) {
      setCurrentPatient((c) => c + 1);
    } else {
      setPhase('running');
    }
  }

  function back() {
    if (currentPatient > 0) {
      setCurrentPatient((c) => c - 1);
    }
  }

  function abort() {
    abortCtrlRef.current?.abort();
  }

  // ─── COLLECTING PHASE ──────────────────────────────────────────
  if (phase === 'collecting') {
    const patient = patients[currentPatient]!;
    const myImages = imagesPerPatient[currentPatient] ?? [];
    const isFirst = currentPatient === 0;
    const isLast = currentPatient === patients.length - 1;
    return (
      <section>
        <h1>איסוף תמונות — {currentPatient + 1} מתוך {patients.length}</h1>
        <div
          style={{
            background: 'var(--card)',
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--border)',
            marginBottom: 12,
          }}
        >
          <strong dir="auto" style={{ fontSize: 16 }}>{patient.name}</strong>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            חדר {patient.room ?? '—'}
            {patient.bed ? `-${patient.bed}` : ''}
            {' · '}
            גיל {patient.age ?? '—'}
            {patient.dxShort ? ` · ${patient.dxShort}` : ''}
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
          צלם תוכן קליני בלבד (vitals, רשימת בעיות, מעבדה). זהות
          המטופל כבר ידועה מהרשומה — אין צורך לצלם את כרטיס
          המטופל.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <label className="btn-like" aria-label="צלם">
            📷 צלם
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              onChange={onPickImagesForCurrent}
              disabled={compressing}
            />
          </label>
          <label className="btn-like ghost" aria-label="בחר מהגלריה">
            🖼️ גלריה
            <input
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              onChange={onPickImagesForCurrent}
              disabled={compressing}
            />
          </label>
        </div>

        {compressing && (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>דוחס תמונות…</p>
        )}

        {myImages.length > 0 && (
          <ul
            aria-label="תמונות שנוספו"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '8px 0',
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {myImages.map((b) => (
              <li
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'var(--card)',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span>📷</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => removeImage(currentPatient, b.id)}
                  aria-label="הסר תמונה"
                  style={{ minHeight: 24, padding: '0 6px', fontSize: 12 }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          {myImages.length > 0
            ? `${myImages.length} תמונות לחולה זה`
            : 'אין תמונות. ניתן להמשיך גם בלי, אבל ה-SOAP יהיה ריק תוכן קליני.'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="ghost" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="ghost"
            onClick={back}
            disabled={isFirst}
          >
            ← חולה קודם
          </button>
          <button type="button" onClick={advance}>
            {isLast
              ? `צור SOAP לכולם (${patients.length}) ←`
              : 'חולה הבא →'}
          </button>
        </div>
      </section>
    );
  }

  // ─── RUNNING PHASE ──────────────────────────────────────────────
  if (phase === 'running') {
    const events = Array.from(progressByIdx.values());
    const lastEv = events[events.length - 1];
    const completedCount = events.filter((e) => e.status === 'done').length;
    const failedCount = events.filter((e) => e.status === 'failed').length;
    return (
      <section>
        <h1>יוצר SOAPs — {completedCount + failedCount}/{patients.length}</h1>

        {lastEv && (
          <div
            style={{
              background: 'var(--card)',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 12,
            }}
          >
            <strong dir="auto">{lastEv.patient.name}</strong>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {lastEv.index + 1} מתוך {lastEv.total} · {phaseLabel(lastEv.status)}
            </div>
          </div>
        )}

        <ul
          aria-label="סטטוס לכל חולה"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {patients.map((p, i) => {
            const ev = progressByIdx.get(i);
            const status: BatchStatus = ev?.status ?? 'pending';
            return (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--card)',
                  borderRadius: 6,
                  borderInlineStart: `4px solid ${statusColor(status)}`,
                  fontSize: 13,
                }}
              >
                <span dir="auto">{p.name}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    fontWeight: 500,
                  }}
                >
                  {phaseLabel(status)}
                </span>
              </li>
            );
          })}
        </ul>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="ghost" onClick={abort}>
            בטל
          </button>
        </div>
      </section>
    );
  }

  // ─── SUMMARY PHASE ──────────────────────────────────────────────
  // Falls through here when phase === 'summary'.
  const completed = result?.completed ?? [];
  const failed = result?.failed ?? [];
  return (
    <section>
      <h1>סיכום ייצור הקבוצה</h1>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="pill pill-info"
          style={{ background: 'var(--ok, #16a34a)', color: 'white' }}
        >
          ✓ {completed.length} הצליחו
        </span>
        {failed.length > 0 && (
          <span
            className="pill pill-warn"
            style={{ background: 'var(--err, #dc2626)', color: 'white' }}
          >
            ✗ {failed.length} נכשלו
          </span>
        )}
        {result?.aborted && (
          <span className="pill pill-warn">⊘ בוטל</span>
        )}
      </div>

      <ul
        aria-label="תוצאות"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {patients.map((p, i) => {
          // Match completion to patient by index — completed[] preserves
          // the order saveBoth was called, which mirrors the patients[]
          // iteration order. So completed[k] corresponds to the k-th
          // successful patient, which we map back via index counting.
          const completedBeforeMe = patients
            .slice(0, i)
            .filter((_, j) => progressByIdx.get(j)?.status === 'done').length;
          const myCompletion =
            progressByIdx.get(i)?.status === 'done'
              ? completed[completedBeforeMe]
              : undefined;
          const f = failed.find((x) => x.patientId === p.id);
          const ev = progressByIdx.get(i);
          return (
            <li
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'var(--card)',
                borderRadius: 6,
                borderInlineStart: `4px solid ${statusColor(ev?.status ?? 'pending')}`,
              }}
            >
              <div>
                <div dir="auto" style={{ fontWeight: 500 }}>{p.name}</div>
                {f && (
                  <div
                    style={{ fontSize: 12, color: 'var(--err)', marginTop: 4 }}
                    dir="auto"
                  >
                    {f.error}
                  </div>
                )}
              </div>
              {myCompletion && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    nav(`/note/${encodeURIComponent(myCompletion.noteId)}`)
                  }
                  style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }}
                >
                  פתח →
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose}>
          סיום
        </button>
      </div>
    </section>
  );
}

function phaseLabel(status: BatchStatus): string {
  switch (status) {
    case 'pending': return 'ממתין';
    case 'extracting': return 'מנתח תמונות…';
    case 'emitting': return 'יוצר SOAP…';
    case 'saving': return 'שומר…';
    case 'done': return '✓ הסתיים';
    case 'failed': return '✗ נכשל';
    case 'aborted': return '⊘ בוטל';
  }
}

function statusColor(status: BatchStatus): string {
  switch (status) {
    case 'pending': return 'var(--muted, #777)';
    case 'extracting':
    case 'emitting':
    case 'saving':
      return 'var(--info, #3b82f6)';
    case 'done': return 'var(--ok, #16a34a)';
    case 'failed': return 'var(--err, #dc2626)';
    case 'aborted': return 'var(--warn, #d97706)';
  }
}
