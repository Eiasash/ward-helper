/**
 * Ring buffer (capacity 1 per kind) of the most recent agent-turn artifacts,
 * gated behind the Settings "דיבוג" toggle. In-memory only — never persisted,
 * never sent off-device. Clipped bodies preserve both head (for JSON parse
 * errors the user will see at the top) and tail (for structural closers).
 *
 * No PHI ever leaves the device via this module; snapshot() is only rendered
 * into the DebugPanel when the user has explicitly opted in on the Settings
 * screen. The "Copy snapshot" button in the panel is a manual gesture.
 */

export interface ExtractMeta {
  images?: number;
  in_tokens?: number;
  out_tokens?: number;
  ms?: number;
}

export interface EmitMeta {
  noteType?: string;
  in_tokens?: number;
  out_tokens?: number;
  ms?: number;
}

export interface ErrorMeta {
  phase?: string;
  context?: string;
}

export interface Entry {
  body: string;
  meta?: object;
  ts: number;
}

export interface Snapshot {
  extract: Entry | null;
  emit: Entry | null;
  error: Entry | null;
}

const CLIP_LIMIT = 4096;

/**
 * Clip a body to ~4 KB, keeping 60% from the head and 30% from the tail,
 * joined by an elision marker. Head-heavy because JSON parse errors surface
 * in the first few hundred chars; tail preserved so the structural closer
 * of a truncated response is still visible.
 */
export function clip(body: string): string {
  if (body.length <= CLIP_LIMIT) return body;
  const headLen = Math.floor(CLIP_LIMIT * 0.6);
  const tailLen = Math.floor(CLIP_LIMIT * 0.3);
  const elided = body.length - headLen - tailLen;
  const head = body.slice(0, headLen);
  const tail = body.slice(body.length - tailLen);
  return `${head}\n…[${elided} bytes elided]…\n${tail}`;
}

let lastExtract: Entry | null = null;
let lastEmit: Entry | null = null;
let lastError: Entry | null = null;

export function recordExtract(body: string, meta?: ExtractMeta): void {
  lastExtract = { body: clip(body), meta, ts: Date.now() };
}

export function recordEmit(body: string, meta?: EmitMeta): void {
  lastEmit = { body: clip(body), meta, ts: Date.now() };
}

export function recordError(err: unknown, meta?: ErrorMeta): void {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === 'string') {
    msg = err;
  } else {
    msg = String(err);
  }
  lastError = { body: clip(msg), meta, ts: Date.now() };
}

export function snapshot(): Snapshot {
  return { extract: lastExtract, emit: lastEmit, error: lastError };
}

export function clear(): void {
  lastExtract = null;
  lastEmit = null;
  lastError = null;
}
