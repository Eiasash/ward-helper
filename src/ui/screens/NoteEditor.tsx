import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateNote } from '@/notes/orchestrate';
import type { NoteType } from '@/storage/indexed';
import type { ParseFields } from '@/agent/tools';
import { NOTE_LABEL } from '@/notes/templates';
import { resolveContinuity } from '@/notes/continuity';
import { auditChameleonRules, sanitizeForChameleon, wrapForChameleon } from '@/i18n/bidi';
import { useBidiAudit } from '../hooks/useSettings';
import { snapshot as debugSnapshot } from '@/agent/debugLog';
import {
  splitIntoSections,
} from '@/notes/sections';
import {
  loadSnippets,
  expandSnippetAt,
  type SnippetMap,
} from '@/notes/snippets';
import { regenerateSection, replaceSectionInBody } from '@/notes/regenerate';
import { loadSkills } from '@/skills/loader';
import { NOTE_SKILL_MAP } from '@/notes/templates';
import { colorForNoteType } from '@/notes/noteTypeColors';
import {
  decideSoapMode,
  isSoapModeUiEnabled,
  loadModeChoice,
  saveModeChoice,
  SOAP_MODE_LABEL,
  type SoapModeChoice,
} from '@/notes/soapMode';

type Status = 'gen' | 'ready' | 'error';

/**
 * Stable fingerprint of the validated fields, used as a cache key for the
 * generated body. Not cryptographic — just needs (a) deterministic ordering
 * so the same input produces the same hash and (b) cheap. JSON.stringify of
 * sorted keys is both.
 */
function hashFields(f: ParseFields): string {
  const sorted = Object.keys(f).sort();
  const pairs = sorted.map((k) => `${k}:${JSON.stringify((f as Record<string, unknown>)[k])}`);
  // djb2 — 31-bit hash, collisions are fine for a 3-key namespace.
  let h = 5381;
  const str = pairs.join('|');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function NoteEditor() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>('gen');
  const [err, setErr] = useState('');
  const [body, setBody] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('admission');
  const [copied, setCopied] = useState(false);
  const [copiedSection, setCopiedSection] = useState<number | null>(null);
  // 'edit' = the editable textarea (default, lets the doctor tweak the draft).
  // 'cards' = a read-only stack of section cards with per-card copy buttons,
  // designed for the paste-into-Chameleon workflow where the user wants to
  // grab one section at a time without scrolling/selecting in a wall of text.
  const [viewMode, setViewMode] = useState<'edit' | 'cards'>('edit');
  const [regenSectionIdx, setRegenSectionIdx] = useState<number | null>(null);
  const [regenError, setRegenError] = useState<string>('');
  const [snippetMap, setSnippetMap] = useState<SnippetMap>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [bidiAuditOn] = useBidiAudit();
  // Bumping this forces the generate effect to re-run and ignore the cache.
  // Wired to the "Regenerate" button — explicit user intent, unlike the
  // implicit re-mount that used to cost them a real emit each time.
  const [regenTick, setRegenTick] = useState(0);

  // Phase C: SOAP-mode dropdown state. `modeChoice` is the dropdown value
  // ('auto' | 'general' | 'rehab-FIRST' | …); the *effective* mode (with
  // 'auto' resolved against room + continuity) is derived inside the
  // generate effect. `tz` mirrors the validated teudatZehut so the
  // per-patient localStorage key is stable across rerenders. Both are
  // initialized to UI-safe defaults; the effect populates them as it
  // reads sessionStorage.
  const [modeChoice, setModeChoice] = useState<SoapModeChoice>('auto');
  const [tz, setTz] = useState<string | null>(null);
  const [modeUiEnabled] = useState<boolean>(() => isSoapModeUiEnabled());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nt = (sessionStorage.getItem('noteType') ?? 'admission') as NoteType;
        const validated: ParseFields = JSON.parse(sessionStorage.getItem('validated') ?? '{}');
        // Review.tsx persists the original extract confidence alongside the
        // validated fields so the orchestrator's safety guard can see "low"
        // flags on name/age. Missing (older session, direct navigation) falls
        // back to {} — the guard's doctor-name + patient-code rules still run,
        // only the low-confidence rule degrades.
        const confidence: Record<string, 'low' | 'med' | 'high'> = JSON.parse(
          sessionStorage.getItem('validatedConfidence') ?? '{}',
        );
        setNoteType(nt);

        // Phase C: hydrate the dropdown for THIS patient on first arrival.
        // Reading inside the effect (vs lazy useState init) avoids a stale
        // value when the user navigates away + back to a different patient
        // — the effect re-runs, the load picks up the right tz.
        const validatedTz = validated.teudatZehut ?? null;
        setTz(validatedTz);
        const persistedChoice = loadModeChoice(validatedTz);
        // Only set state if the persisted value differs from current —
        // setting to the same value would re-trigger the effect (modeChoice
        // is a dep) and produce a regen loop.
        if (persistedChoice !== modeChoice) {
          setModeChoice(persistedChoice);
          // The setState above will re-run this effect; bail now and let
          // the next pass do the actual generate with the correct mode.
          return;
        }

        const continuityTz = sessionStorage.getItem('continuityTeudatZehut');
        const continuity = continuityTz ? await resolveContinuity(continuityTz) : null;

        // Resolve the effective mode now that we have continuity + room
        // hint. 'general' is the default fall-through when the SOAP-mode
        // feature flag is off OR the resolver finds no rehab signal.
        const effectiveMode = decideSoapMode({
          roomHint: validated.room ?? null,
          manualOverride: persistedChoice,
          continuity,
        });

        // Cache key incorporates the effective mode so a dropdown change
        // invalidates the cached body and forces a real re-emit. The
        // alternative — keying only on noteType+fields — would silently
        // serve a stale 'general' body when the user switches to a
        // 'rehab-*' mode.
        const cacheKey = `${nt}:${hashFields(validated)}:${effectiveMode}`;
        const cachedBody = sessionStorage.getItem('body');
        const cachedKey = sessionStorage.getItem('bodyKey');
        // regenTick > 0 means the user clicked "Regenerate" — always
        // re-emit, don't take the cached body.
        if (regenTick === 0 && cachedBody && cachedKey === cacheKey) {
          if (cancelled) return;
          setBody(cachedBody);
          setStatus('ready');
          return;
        }

        setStatus('gen');

        const text = await generateNote(
          nt,
          { fields: validated, confidence },
          continuity,
          effectiveMode,
        );
        if (cancelled) return;
        setBody(text);
        sessionStorage.setItem('body', text);
        sessionStorage.setItem('bodyKey', cacheKey);
        setStatus('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        setErr((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // modeChoice is a dep so that changing the dropdown re-runs the
    // generate effect (and the cacheKey now embeds the effective mode,
    // so it actually re-emits rather than serving stale).
  }, [regenTick, modeChoice]);

  useEffect(() => {
    if (body) sessionStorage.setItem('body', body);
  }, [body]);

  // Load snippets once on mount. Failure → empty map (no expansion), which
  // is the safe degrade — typing `/nc ` just stays as `/nc `.
  useEffect(() => {
    let cancelled = false;
    loadSnippets()
      .then((m) => {
        if (!cancelled) setSnippetMap(m);
      })
      .catch(() => {
        /* ignore — degrade silently to no snippets */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(() => splitIntoSections(body), [body]);

  // Live audit is a dev-time affordance, opt-in via Settings. In normal use
  // the clipboard sanitizer handles violations silently; the banner exists
  // so prompt tuners can see what the model produced before sanitization.
  const issues = useMemo(
    () => (bidiAuditOn ? auditChameleonRules(body) : []),
    [body, bidiAuditOn],
  );

  /**
   * Phase C: dropdown change handler. Persists the choice per-patient
   * (key = teudatZehut, NOT patientId — the patient row is upserted
   * AFTER generateNote returns, so patientId doesn't exist yet at this
   * call site). Setting modeChoice triggers the generate effect via its
   * dep array, which in turn invalidates the cache and re-emits.
   */
  function onModeChoiceChange(next: SoapModeChoice) {
    if (next === modeChoice) return;
    saveModeChoice(tz, next);
    sessionStorage.removeItem('body');
    sessionStorage.removeItem('bodyKey');
    setModeChoice(next);
  }

  async function onCopy() {
    // Last-chance sanitize at the clipboard boundary — even if the draft
    // somehow still contains forbidden chars (e.g. user just typed one),
    // the pasted text is clean.
    const clean = sanitizeForChameleon(body);
    await navigator.clipboard.writeText(clean);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onCopySection(idx: number, sectionBody: string) {
    const clean = sanitizeForChameleon(sectionBody);
    await navigator.clipboard.writeText(clean);
    setCopiedSection(idx);
    setTimeout(() => setCopiedSection((c) => (c === idx ? null : c)), 1500);
  }

  function onAutoClean() {
    setBody(sanitizeForChameleon(body));
  }

  /**
   * Per-section regenerate. Hits a focused emit (max_tokens 1500, system =
   * the same per-note-type skill bundle the full emit uses) and surgically
   * replaces ONLY the named section in `body`. Never re-emits the whole
   * note; the orchestrator's full path is left intact for "create from
   * scratch" only. Result flows through wrapForChameleon for the same
   * bidi/sanitize hardening the full emit gets.
   */
  async function onRegenerateSection(idx: number) {
    if (regenSectionIdx !== null) return; // ignore concurrent taps
    setRegenSectionIdx(idx);
    setRegenError('');
    try {
      const skills = NOTE_SKILL_MAP[noteType];
      const skillContent = await loadSkills([...skills]);
      const newSectionRaw = await regenerateSection({
        noteType,
        body,
        sectionIndex: idx,
        systemSkillContent: skillContent,
      });
      const cleanedSection = wrapForChameleon(newSectionRaw);
      const next = replaceSectionInBody(body, idx, cleanedSection);
      setBody(next);
      sessionStorage.setItem('body', next);
    } catch (e) {
      setRegenError((e as Error).message ?? 'regenerate failed');
    } finally {
      setRegenSectionIdx(null);
    }
  }

  // Snippet expansion fires on KeyUp after a space is typed. Replacing the
  // textarea content via React reset the cursor — we restore it manually
  // after React applies the new value.
  function onTextareaKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== ' ') return;
    const el = e.currentTarget;
    const cursor = el.selectionStart ?? 0;
    const result = expandSnippetAt(el.value, cursor, snippetMap);
    if (result.text === el.value && result.cursorIndex === cursor) return;
    setBody(result.text);
    // Set caret on the next tick so React's value update has landed.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.selectionStart = result.cursorIndex;
      ta.selectionEnd = result.cursorIndex;
    });
  }

  if (status === 'gen') {
    return (
      <section>
        <h1>יוצר טיוטת {NOTE_LABEL[noteType]}...</h1>
      </section>
    );
  }

  if (status === 'error') {
    // Show the raw model body (clipped via debugLog) so the user can see what
    // the model returned without any chance of pasting it as a "note" into
    // Chameleon. The textarea stays absent — only "Regenerate" can recover.
    const rawBody = debugSnapshot().emit?.body ?? '';
    // Detect proxy timeout — the dominant failure mode for long admission/
    // discharge emits without a BYO API key. The Toranot proxy has a ~10s
    // upstream ceiling; emits with 25 KB of skill content + 4096 output
    // tokens regularly hit 20-40s. Surface the actionable fix (set your
    // own Anthropic API key in Settings) rather than just showing "504".
    const is504 = /504|Upstream timeout|FUNCTION_INVOCATION_TIMEOUT/i.test(err);
    return (
      <section>
        <h1>שגיאה — {NOTE_LABEL[noteType]}</h1>
        <div className="pill pill-err" style={{ marginBlock: 8 }}>
          לא הצלחתי לקרוא את התגובה מהמודל. לחץ "צור מחדש" כדי לנסות שוב.
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBlock: 8 }}>{err}</p>
        {is504 && (
          <div
            style={{
              background: 'var(--warn)',
              color: 'black',
              padding: '10px 12px',
              borderRadius: 8,
              marginBlock: 12,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>Timeout בפרוקסי (10s).</strong>
            <br />
            פתקי קבלה / שחרור ארוכים חוצים את התקרה. הפתרון: הוסף מפתח Anthropic
            אישי ב-<button
              onClick={() => nav('/settings')}
              style={{
                background: 'transparent',
                border: 0,
                padding: 0,
                color: 'var(--app-primary)',
                textDecoration: 'underline',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >הגדרות</button> — המפתח עובר ישירות ל-Anthropic
            (90s timeout במקום 10s) ומסתנכרן בין מכשירים אם הפעלת סיסמת ענן.
          </div>
        )}
        {rawBody && (
          <details style={{ marginBlock: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
              טכני (debug)
            </summary>
            <pre className="debug-pre" dir="ltr">{rawBody.slice(0, 2000)}</pre>
          </details>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              sessionStorage.removeItem('body');
              sessionStorage.removeItem('bodyKey');
              setRegenTick((t) => t + 1);
            }}
          >
            🔄 צור מחדש
          </button>
          <button className="ghost" onClick={() => nav('/capture')}>
            חזרה
          </button>
        </div>
      </section>
    );
  }

  const tone = colorForNoteType(noteType);

  return (
    <section
      data-note-type={noteType}
      style={{
        // 4px top border identifies note type at a glance — paired with the
        // header-strip badge so a wrong-template paste is impossible to miss.
        borderTop: `4px solid ${tone.color}`,
        marginTop: -4,
        paddingTop: 8,
      }}
    >
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 6,
            background: tone.soft,
            color: tone.fg,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {tone.badge}
        </span>
        <span>טיוטת {NOTE_LABEL[noteType]}</span>
      </h1>

      {noteType === 'soap' && modeUiEnabled && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            fontSize: 13,
          }}
        >
          <label htmlFor="soap-mode-select" style={{ color: 'var(--muted)' }}>
            מצב SOAP:
          </label>
          <select
            id="soap-mode-select"
            value={modeChoice}
            onChange={(e) => onModeChoiceChange(e.target.value as SoapModeChoice)}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-strong)',
              background: 'var(--card)',
              color: 'var(--fg)',
              minHeight: 32,
              fontSize: 13,
            }}
          >
            <option value="auto">{SOAP_MODE_LABEL.auto}</option>
            <option value="general">{SOAP_MODE_LABEL.general}</option>
            <option value="rehab-FIRST">{SOAP_MODE_LABEL['rehab-FIRST']}</option>
            <option value="rehab-STABLE">{SOAP_MODE_LABEL['rehab-STABLE']}</option>
            <option value="rehab-COMPLEX">{SOAP_MODE_LABEL['rehab-COMPLEX']}</option>
            <option value="rehab-HD-COMPLEX">
              {SOAP_MODE_LABEL['rehab-HD-COMPLEX']}
            </option>
          </select>
        </div>
      )}

      {issues.length > 0 && (
        <div
          role="status"
          style={{
            background: 'var(--card)',
            color: 'var(--muted)',
            padding: 10,
            borderRadius: 8,
            marginBottom: 10,
            fontSize: 13,
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
          }}
        >
          <strong style={{ color: 'var(--muted)' }}>
            audit: {issues.length} בעיית פורמט לצ׳מיליון
          </strong>
          <ul style={{ margin: '6px 0 8px 18px', padding: 0 }}>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            onClick={onAutoClean}
            style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
          >
            נקה אוטומטית
          </button>
        </div>
      )}

      {sections.length > 1 && (
        <div
          className="section-copy-row"
          role="toolbar"
          aria-label="פעולות לפי קטע"
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBlock: 8,
            marginBottom: 8,
          }}
        >
          {sections.map((s, i) => {
            const regenInProgress = regenSectionIdx === i;
            return (
              <div
                key={`${i}:${s.name}`}
                style={{
                  display: 'inline-flex',
                  gap: 0,
                  flex: '0 0 auto',
                  borderRadius: 8,
                  border: '1px solid var(--border-strong)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onCopySection(i, s.body)}
                  style={{
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    padding: '6px 10px',
                    minHeight: 32,
                    border: 'none',
                    borderRadius: 0,
                  }}
                >
                  {copiedSection === i ? '✓ הועתק' : s.name}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onRegenerateSection(i)}
                  disabled={regenSectionIdx !== null}
                  title={`צור מחדש את הקטע "${s.name}" (פנייה ממוקדת — לא רשומה שלמה)`}
                  aria-label={`צור מחדש את הקטע ${s.name}`}
                  style={{
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    padding: '6px 10px',
                    minHeight: 32,
                    border: 'none',
                    borderInlineStart: '1px solid var(--border)',
                    borderRadius: 0,
                  }}
                >
                  {regenInProgress ? '…' : '↻'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {regenError && (
        <div
          role="alert"
          className="pill pill-warn"
          style={{ marginBlock: 6, display: 'block', padding: '8px 10px' }}
        >
          ⚠ צור-מחדש לקטע נכשל: {regenError}
        </div>
      )}

      <label htmlFor="note-editor-body" className="visually-hidden">
        טקסט הטיוטה — {NOTE_LABEL[noteType]}
      </label>
      {viewMode === 'edit' ? (
        <textarea
          id="note-editor-body"
          ref={textareaRef}
          dir="auto"
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyUp={onTextareaKeyUp}
          aria-label={`טקסט הטיוטה — ${NOTE_LABEL[noteType]}`}
          style={{ minHeight: 400, fontSize: 15, lineHeight: 1.6 }}
        />
      ) : (
        <div className="section-cards" aria-label="קטעי הרשומה — מוכנים להעתקה">
          {sections.length === 0 ? (
            <p className="muted">אין תוכן להצגה.</p>
          ) : (
            sections.map((s, i) => (
              <article key={`${i}:${s.name}`} className="section-card">
                <header className="section-card__header">
                  <h3 className="section-card__title">{s.name}</h3>
                  <button
                    type="button"
                    className="section-card__copy"
                    onClick={() => onCopySection(i, s.body)}
                    aria-label={`העתק את הקטע ${s.name}`}
                  >
                    {copiedSection === i ? '✓ הועתק' : '📋 העתק'}
                  </button>
                </header>
                <pre className="section-card__body" dir="auto">
                  {s.body}
                </pre>
              </article>
            ))
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={onCopy}>{copied ? '✓ הועתק' : '📋 העתק הכל'}</button>
        <button
          type="button"
          className="ghost"
          onClick={() => setViewMode((m) => (m === 'edit' ? 'cards' : 'edit'))}
          aria-pressed={viewMode === 'cards'}
          title={
            viewMode === 'edit'
              ? 'הצג את הרשומה כקטעים נפרדים, עם כפתור העתקה לכל קטע'
              : 'חזור למצב עריכה (טקסט פתוח)'
          }
        >
          {viewMode === 'edit' ? '📑 צפייה בקטעים' : '✏ חזרה לעריכה'}
        </button>
        <button className="ghost" onClick={() => nav('/save')}>המשך לשמירה ←</button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            sessionStorage.removeItem('body');
            sessionStorage.removeItem('bodyKey');
            setRegenTick((t) => t + 1);
          }}
          style={{ marginInlineStart: 'auto', fontSize: 13 }}
          title="צור טיוטה מחדש (בתשלום — שלח בקשה חדשה)"
        >
          🔄 צור מחדש
        </button>
      </div>
    </section>
  );
}
