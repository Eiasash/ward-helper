/**
 * Roster importers — three paths into the daily department snapshot.
 *
 *   importViaOcr(file)    — phone snap of the AZMA "ניהול מחלקה" grid;
 *                            extracts via the existing Toranot proxy
 *                            (no key needed — proxy default model is
 *                            Sonnet 4.6, which is plenty for this kind
 *                            of structured grid extraction).
 *   importViaPaste(text)  — copy/paste from AZMA or a hand-typed list.
 *                            Auto-detects pipe-delimited vs tab-separated
 *                            (AZMA grid copy) shapes.
 *   importViaManual(rows) — shape pass-through for the modal's manual
 *                            entry tab.
 *
 * All three return Promise<RosterPatient[]> with `id` minted via
 * crypto.randomUUID, `sourceMode` set per importer, and `importedAt`
 * set to Date.now() at the moment of import.
 *
 * Failure posture: each importer surfaces structured failures rather
 * than throwing on dirty input. Garbage paste returns []; OCR JSON
 * malformation throws with a Hebrew message the modal can display.
 * The modal's preview step is the user's last line of defense — they
 * eyeball + edit + commit, so a permissive parser that occasionally
 * yields a wrong row beats a strict one that yields nothing.
 */

import { callClaude } from '@/ai/dispatch';
import { type AnthropicContentBlock } from '@/agent/client';
import { stripMarkdownFence } from '@/agent/loop';
import { compressImage, estimateDataUrlBytes } from '@/camera/compress';
import { pushBreadcrumb } from '@/ui/components/MobileDebugPanel';
import { normalizeIsraeliTz, isValidIsraeliTzLuhn } from './israeliTz';
import type { RosterPatient } from '@/storage/roster';

// ─── Types ─────────────────────────────────────────────────────────

/**
 * Manual-entry row shape consumed by importViaManual. The modal's
 * Manual tab edits these directly. All clinical fields optional —
 * the only requirement is that `name` be non-empty (rows without a
 * name are dropped, since a SOAP without a patient name is useless).
 */
export interface ManualRow {
  tz?: string | null;
  name: string;
  age?: number | null;
  sex?: 'M' | 'F' | null;
  room?: string | null;
  bed?: string | null;
  losDays?: number | null;
  dxShort?: string | null;
}

// ─── OCR importer ──────────────────────────────────────────────────

// Field names match the RosterPatient interface camelCase exactly. The
// pre-fixup version used `id` for the patient's clinical identifier,
// which collided with the importer's UUID `id` field — a refactor to
// `Object.assign(row, parsedJson)` would have silently clobbered the
// UUID. Fixed by renaming `id` → `tz` (the right clinical name) and
// switching `los_days`/`dx_short` to camelCase to remove the
// snake↔camel translation step.
const OCR_SYSTEM_PROMPT = `אתה מחלץ רשימת חולים מצילום של מסך AZMA או מדף מודפס של
רשימת המחלקה (handover sheet — דף נייר). החזר JSON תקני בלבד עם
מערך patients. כל חולה:
- tz (תעודת זהות, מספר 9 ספרות בלבד או null אם לא מוצג —
  זה השדה הקליני המזהה, לא להמציא ולא לחתוך)
- name (שם מלא בעברית כפי שמופיע)
- age (מספר או null)
- sex ('M'|'F'|null)
- room (מספר חדר או null — שים לב: הספרה הראשונה היא הקומה,
  אל תחתוך אפסים מובילים)
- bed (אות או מספר מיטה או null)
- losDays (ימי אשפוז כמספר או null)
- dxShort (אבחנה ראשית קצרה או null)
דלג על שורות כותרת. במקרה של ספק לגבי שם או tz — החזר null.
אל תמציא מידע. JSON only, no markdown fences.`;

interface OcrPatientRaw {
  tz?: string | null;
  name?: string | null;
  age?: number | null;
  sex?: 'M' | 'F' | null;
  room?: string | null;
  bed?: string | null;
  losDays?: number | null;
  dxShort?: string | null;
}

// ת.ז. validation moved to ./israeliTz.ts (length + Luhn). The legacy
// length-only `normalizeTz` accepted Luhn-invalid 9-digit garbage like
// "666544000"; the new shared `normalizeIsraeliTz` rejects it.

/** Stage callback for the import pipeline. UI consumers render progress. */
export type OcrStage =
  | 'reading'
  | 'compressing'
  | 'uploading'
  | 'analyzing'
  | 'parsing'
  | 'done';

/**
 * Optional knobs for importViaOcr. The defaults match the original
 * call site (`importViaOcr(file)` still works) — `onProgress` and
 * `signal` are pure additions that the modal uses for the v1.39.1
 * stuck-on-mobile fix.
 */
export interface OcrOptions {
  onProgress?: (stage: OcrStage) => void;
  signal?: AbortSignal;
}

/**
 * Extract roster from a phone snap of AZMA's department grid.
 *
 * v1.39.1 pipeline (mobile-Chrome stuck-on-upload fix):
 *   1. reading      — File → data URL (~10MB phone JPEG → ~13MB base64)
 *   2. compressing  — downscale via compressImage(census mode):
 *                     longest-edge 1600px + JPEG q=0.85, EXIF auto-applied
 *                     by the browser image decoder. Typical 13MB → ~600KB.
 *                     If decode fails (corrupt image, unusual format),
 *                     we log + use the raw data URL — model may still
 *                     handle it; better than blocking the doctor entirely.
 *   3. uploading    — POST to proxy or direct API per dispatch.ts
 *                     3-state routing. AbortSignal is plumbed end-to-end
 *                     so a 90s timeout in the modal cancels the in-flight
 *                     fetch instead of leaving it hanging.
 *   4. analyzing    — model inference (server-side; client just waits)
 *   5. parsing      — JSON.parse + structured field validation
 *   6. done
 *
 * Every stage transition logs to pushBreadcrumb so a debug-panel dump
 * shows exactly where a real "stuck" report stalled.
 */
export async function importViaOcr(
  file: File,
  opts: OcrOptions = {},
): Promise<RosterPatient[]> {
  const { onProgress, signal } = opts;
  const t0 = Date.now();

  onProgress?.('reading');
  pushBreadcrumb('roster.ocr.read', {
    name: file.name,
    bytes: file.size,
    type: file.type,
  });
  const rawDataUrl = await readAsDataUrl(file);

  onProgress?.('compressing');
  // EXIF orientation is auto-applied by the <img> decoder used inside
  // compressImage on Chrome 81+ / mobile Chrome on Android — no extra
  // canvas rotation needed. census mode is the calibrated path for
  // dense AZMA grids per the comment in src/camera/compress.ts.
  let dataUrl = rawDataUrl;
  try {
    dataUrl = await compressImage(rawDataUrl, 'census');
    pushBreadcrumb('roster.ocr.compressed', {
      from: estimateDataUrlBytes(rawDataUrl),
      to: estimateDataUrlBytes(dataUrl),
      ms: Date.now() - t0,
    });
  } catch (err) {
    // Decode failed (corrupt image / unsupported format). Don't block
    // the doctor — fall through with the raw data URL. The model may
    // still handle it, and any fetch-level failure surfaces below.
    pushBreadcrumb('roster.ocr.compressFailed', {
      err: (err as Error).message ?? String(err),
      bytes: estimateDataUrlBytes(rawDataUrl),
    });
  }

  if (signal?.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }

  const imageBlock = dataUrlToImageBlock(dataUrl);

  const content: AnthropicContentBlock[] = [
    imageBlock,
    {
      type: 'text',
      text: 'Extract the department roster from this AZMA screenshot. Return strict JSON: { "patients": [...] } per the system instructions.',
    },
  ];

  onProgress?.('uploading');
  pushBreadcrumb('roster.ocr.uploadStart', {
    bytes: estimateDataUrlBytes(dataUrl),
  });
  onProgress?.('analyzing');

  const res = await callClaude(
    {
      messages: [{ role: 'user', content }],
      max_tokens: 4000,
      system: OCR_SYSTEM_PROMPT,
    },
    { retryOnTransient: 1, signal },
  );

  pushBreadcrumb('roster.ocr.uploadDone', {
    ms: Date.now() - t0,
    in_tokens: res.usage?.input_tokens,
    out_tokens: res.usage?.output_tokens,
  });

  onProgress?.('parsing');
  const text = res.content.map((b) => b.text).join('\n').trim();
  if (!text) {
    pushBreadcrumb('roster.ocr.empty', { ms: Date.now() - t0 });
    throw new Error('פלט ריק מהמודל. נסה שוב או בחר תמונה אחרת.');
  }

  let parsed: { patients?: unknown };
  try {
    parsed = JSON.parse(stripMarkdownFence(text)) as { patients?: unknown };
  } catch {
    pushBreadcrumb('roster.ocr.parseFail', {
      preview: text.slice(0, 120),
      ms: Date.now() - t0,
    });
    throw new Error('המודל החזיר פלט שאינו JSON תקני. נסה שוב.');
  }

  if (!Array.isArray(parsed.patients)) {
    return [];
  }

  const now = Date.now();
  const out: RosterPatient[] = [];
  for (const raw of parsed.patients as OcrPatientRaw[]) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    out.push({
      id: crypto.randomUUID(),
      tz: normalizeTz(raw.tz),
      name,
      age: typeof raw.age === 'number' && raw.age > 0 ? raw.age : null,
      sex: raw.sex === 'M' || raw.sex === 'F' ? raw.sex : null,
      room: typeof raw.room === 'string' && raw.room.trim() ? raw.room.trim() : null,
      bed: typeof raw.bed === 'string' && raw.bed.trim() ? raw.bed.trim() : null,
      losDays: typeof raw.losDays === 'number' && raw.losDays >= 0 ? raw.losDays : null,
      dxShort:
        typeof raw.dxShort === 'string' && raw.dxShort.trim() ? raw.dxShort.trim() : null,
      sourceMode: 'ocr',
      importedAt: now,
    });
  }
  onProgress?.('done');
  pushBreadcrumb('roster.ocr.done', {
    rows: out.length,
    ms: Date.now() - t0,
  });
  return out;
}

// ─── Paste importer ────────────────────────────────────────────────

/**
 * Parse a pasted roster. Tries pipe-delimited first (more constrained,
 * less ambiguous) then tab-separated AZMA grid format. Returns [] for
 * unrecognized shapes — the modal surfaces a "פורמט לא מזוהה" toast.
 *
 * Pipe format: 7 fields per line — `id | name | age | room | bed | los | dx`
 * AZMA grid:   tab-separated, header auto-detected by Hebrew column names
 *              (חדר, מיטה, שם, גיל, ת.ז., מין, ימי אשפוז, אבחנה, ...).
 */
export function importViaPaste(text: string): RosterPatient[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  if (lines.some((l) => l.includes('|'))) {
    return parsePipeFormat(lines);
  }
  if (lines.some((l) => l.includes('\t'))) {
    return parseAzmaTsv(lines);
  }
  return [];
}

function parsePipeFormat(lines: string[]): RosterPatient[] {
  const now = Date.now();
  const out: RosterPatient[] = [];
  for (const line of lines) {
    const cells = line.split('|').map((c) => c.trim());
    // Skip header rows — heuristic: a row whose first cell is "id" or "ID"
    // or contains the word "name"/"שם" is probably a column legend.
    const head = cells[0]?.toLowerCase() ?? '';
    if (head === 'id' || head === 'name' || head === 'שם') continue;
    if (cells.length < 2) continue;
    const name = cells[1] ?? '';
    if (!name) continue;
    out.push({
      id: crypto.randomUUID(),
      tz: normalizeTz(cells[0]),
      name,
      age: parseIntOrNull(cells[2]),
      sex: null,
      room: cells[3] || null,
      bed: cells[4] || null,
      losDays: parseIntOrNull(cells[5]),
      dxShort: cells[6] || null,
      sourceMode: 'paste',
      importedAt: now,
    });
  }
  return out;
}

/**
 * AZMA TSV header detection.
 *
 * Columns we map to RosterPatient fields are listed first. The set
 * after `// --- AZMA spec §4 documented columns ---` is the canonical
 * 21-column on-screen grid per the `azma-ui` skill manifest — those
 * columns aren't carrying RosterPatient data, but their PRESENCE in a
 * paste tells us "this is an AZMA grid, fire the detector". They map
 * to `_skip` so detectHeaderColumns returns a non-empty map (so
 * parseAzmaTsv doesn't bail out) while keeping the data parser
 * indifferent to them.
 *
 * NOTE — TENTATIVE: the mapped column tokens (שם / ת.ז. / מיטה /
 * ימי אשפוז) are educated guesses for how an AZMA clipboard export
 * renders identity columns. The on-screen 21-col grid notably does
 * NOT include these. Real-paste calibration with an actual AZMA
 * clipboard sample is pending — replace this comment when confirmed.
 */
type HeaderField = keyof RosterPatient | 'sex' | '_skip';

const HEADER_TOKENS: Record<string, HeaderField> = {
  // Identity / clinical fields → mapped to RosterPatient
  שם: 'name',
  'שם מטופל': 'name',
  'שם המטופל': 'name',
  name: 'name',
  גיל: 'age',
  age: 'age',
  חדר: 'room',
  room: 'room',
  מיטה: 'bed',
  bed: 'bed',
  'ת.ז': 'tz',
  'ת.ז.': 'tz',
  'תעודת זהות': 'tz',
  tz: 'tz',
  מין: 'sex',
  sex: 'sex',
  'ימי אשפוז': 'losDays',
  los: 'losDays',
  אבחנה: 'dxShort',
  'אבחנה ראשית': 'dxShort',
  dx: 'dxShort',

  // --- AZMA spec §4 documented columns (presence triggers detector,
  // not mapped to RosterPatient — clipboard payload, not roster data).
  מחלקה: '_skip',
  'חיידק עמיד': '_skip',
  צד: '_skip',
  מ: '_skip',
  דם: '_skip',
  מספר: '_skip',
  בדיקות: '_skip',
  יעוץ: '_skip',
  'רפואי-קבלה': '_skip',
  'רפואי-ביקור': '_skip',
  'רפואי-סיכום': '_skip',
  רקע: '_skip',
  'תנועה אחרונה': '_skip',
  'case manager': '_skip',
};

function detectHeaderColumns(headerLine: string): Map<number, HeaderField> {
  const cells = headerLine.split('\t').map((c) => c.trim().toLowerCase());
  const map = new Map<number, HeaderField>();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] ?? '';
    const field = HEADER_TOKENS[cell];
    if (field) map.set(i, field);
  }
  return map;
}

function parseAzmaTsv(lines: string[]): RosterPatient[] {
  const headerMap = detectHeaderColumns(lines[0] ?? '');
  if (headerMap.size < 1) return [];

  const dataLines = lines.slice(1);
  const now = Date.now();
  const out: RosterPatient[] = [];
  for (const line of dataLines) {
    const cells = line.split('\t').map((c) => c.trim());
    const row: Partial<RosterPatient> & { sex?: 'M' | 'F' | null } = {};
    for (const [colIdx, field] of headerMap) {
      const value = cells[colIdx];
      if (value === undefined || value === '') continue;
      switch (field) {
        case 'name':
          row.name = value;
          break;
        case 'age':
          row.age = parseIntOrNull(value);
          break;
        case 'room':
          row.room = value;
          break;
        case 'bed':
          row.bed = value;
          break;
        case 'tz':
          row.tz = normalizeTz(value);
          break;
        case 'sex':
          row.sex = parseSex(value);
          break;
        case 'losDays':
          row.losDays = parseIntOrNull(value);
          break;
        case 'dxShort':
          row.dxShort = value;
          break;
        case '_skip':
        default:
          // AZMA-spec column we recognized to fire the detector but
          // don't carry into RosterPatient. No-op.
          break;
      }
    }
    if (!row.name) continue;
    out.push({
      id: crypto.randomUUID(),
      tz: row.tz ?? null,
      name: row.name,
      age: row.age ?? null,
      sex: row.sex ?? null,
      room: row.room ?? null,
      bed: row.bed ?? null,
      losDays: row.losDays ?? null,
      dxShort: row.dxShort ?? null,
      sourceMode: 'paste',
      importedAt: now,
    });
  }
  return out;
}

// ─── Manual importer ───────────────────────────────────────────────

/** Shape-only pass-through for the modal's manual entry tab. */
export function importViaManual(rows: ManualRow[]): RosterPatient[] {
  const now = Date.now();
  return rows
    .filter((r) => r.name && r.name.trim().length > 0)
    .map((r) => ({
      id: crypto.randomUUID(),
      tz: r.tz?.trim() && isValidIsraeliTzLuhn(r.tz.trim()) ? r.tz.trim() : null,
      name: r.name.trim(),
      age: typeof r.age === 'number' && r.age > 0 ? r.age : null,
      sex: r.sex ?? null,
      room: r.room?.trim() || null,
      bed: r.bed?.trim() || null,
      losDays: typeof r.losDays === 'number' && r.losDays >= 0 ? r.losDays : null,
      dxShort: r.dxShort?.trim() || null,
      sourceMode: 'manual' as const,
      importedAt: now,
    }));
}

// ─── Helpers ───────────────────────────────────────────────────────

// Local alias preserved for call-site readability; delegates to shared
// validator that includes Luhn check (v1.39.3).
function normalizeTz(raw: unknown): string | null {
  return normalizeIsraeliTz(raw);
}

function parseIntOrNull(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  // Accept Hebrew/Arabic-Indic and Latin digits. The doctor's keyboard
  // sometimes flips locales mid-paste; tolerating both is a freebie.
  const normalized = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const n = parseInt(normalized, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseSex(s: string): 'M' | 'F' | null {
  const v = s.trim().toLowerCase();
  if (v === 'm' || v === 'male' || v === 'ז' || v === 'זכר') return 'M';
  if (v === 'f' || v === 'female' || v === 'נ' || v === 'נקבה') return 'F';
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(file);
  });
}

function dataUrlToImageBlock(dataUrl: string): AnthropicContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('invalid data URL');
  const raw = m[1] ?? 'image/jpeg';
  const data = m[2] ?? '';
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
  const mediaType = (allowed as readonly string[]).includes(raw)
    ? (raw as (typeof allowed)[number])
    : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}
