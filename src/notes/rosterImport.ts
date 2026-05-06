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

import { callAnthropic, type AnthropicContentBlock } from '@/agent/client';
import { stripMarkdownFence } from '@/agent/loop';
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

const OCR_SYSTEM_PROMPT = `אתה מחלץ רשימת חולים מצילום מסך AZMA. החזר JSON תקני בלבד עם
מערך patients. כל חולה: id (החזר null אם לא מוצג), name (שם מלא
בעברית כפי שמופיע), age (מספר או null), sex ('M'|'F'|null),
room (מספר חדר או null), bed (אות מיטה או null), los_days
(מספר ימי אשפוז או null), dx_short (אבחנה ראשית קצרה או null).
דלג על שורות כותרת. במקרה של ספק לגבי שם — החזר null. אל
תמציא מידע. JSON only, no markdown fences.`;

interface OcrPatientRaw {
  id?: string | null;
  name?: string | null;
  age?: number | null;
  sex?: 'M' | 'F' | null;
  room?: string | null;
  bed?: string | null;
  los_days?: number | null;
  dx_short?: string | null;
}

/** Strict 9-digit ת.ז. check — matches the safety guard in orchestrate.ts. */
const ISRAELI_TZ_RE = /^\d{9}$/;

/** Extract roster from a phone snap of AZMA's department grid. */
export async function importViaOcr(file: File): Promise<RosterPatient[]> {
  const dataUrl = await readAsDataUrl(file);
  const imageBlock = dataUrlToImageBlock(dataUrl);

  const content: AnthropicContentBlock[] = [
    imageBlock,
    {
      type: 'text',
      text: 'Extract the department roster from this AZMA screenshot. Return strict JSON: { "patients": [...] } per the system instructions.',
    },
  ];

  const res = await callAnthropic(
    {
      messages: [{ role: 'user', content }],
      max_tokens: 4000,
      system: OCR_SYSTEM_PROMPT,
    },
    { retryOnTransient: 1 },
  );

  const text = res.content.map((b) => b.text).join('\n').trim();
  if (!text) {
    throw new Error('פלט ריק מהמודל. נסה שוב או בחר תמונה אחרת.');
  }

  let parsed: { patients?: unknown };
  try {
    parsed = JSON.parse(stripMarkdownFence(text)) as { patients?: unknown };
  } catch {
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
      tz: normalizeTz(raw.id),
      name,
      age: typeof raw.age === 'number' && raw.age > 0 ? raw.age : null,
      sex: raw.sex === 'M' || raw.sex === 'F' ? raw.sex : null,
      room: typeof raw.room === 'string' && raw.room.trim() ? raw.room.trim() : null,
      bed: typeof raw.bed === 'string' && raw.bed.trim() ? raw.bed.trim() : null,
      losDays: typeof raw.los_days === 'number' && raw.los_days >= 0 ? raw.los_days : null,
      dxShort:
        typeof raw.dx_short === 'string' && raw.dx_short.trim() ? raw.dx_short.trim() : null,
      sourceMode: 'ocr',
      importedAt: now,
    });
  }
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

const HEADER_TOKENS: Record<string, keyof RosterPatient | 'sex'> = {
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
  id: 'tz',
  מין: 'sex',
  sex: 'sex',
  'ימי אשפוז': 'losDays',
  los: 'losDays',
  אבחנה: 'dxShort',
  'אבחנה ראשית': 'dxShort',
  dx: 'dxShort',
};

function detectHeaderColumns(headerLine: string): Map<number, keyof RosterPatient | 'sex'> {
  const cells = headerLine.split('\t').map((c) => c.trim().toLowerCase());
  const map = new Map<number, keyof RosterPatient | 'sex'>();
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
      tz: r.tz?.trim() && ISRAELI_TZ_RE.test(r.tz.trim()) ? r.tz.trim() : null,
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

function normalizeTz(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return ISRAELI_TZ_RE.test(trimmed) ? trimmed : null;
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
