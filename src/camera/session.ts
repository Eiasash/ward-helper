/**
 * Capture session — ordered blocks of image + text inputs.
 *
 * Blocks are held in a single ordered array. Image blocks store both a data
 * URL (for the agent extract upload) and a blob URL (for cheap UI preview).
 * Text blocks store the literal content. Nothing is persisted to disk; on
 * `clearBlocks()` every blob URL is revoked so memory is released.
 *
 * Order is meaningful: a text block that follows an image block is
 * interpreted by the extract turn as commentary on that image. Reordering
 * via `reorderBlocks` lets the user re-arrange before the extract call.
 */

export type ImageSource = 'camera' | 'gallery' | 'clipboard';
export type TextSource = 'typed' | 'paste';
export type PdfSource = 'gallery';

export interface ImageBlock {
  kind: 'image';
  id: string;
  dataUrl: string;
  blobUrl: string;
  sourceLabel: ImageSource;
  addedAt: number;
}

export interface TextBlock {
  kind: 'text';
  id: string;
  content: string;
  sourceLabel: TextSource;
  addedAt: number;
}

export interface PdfBlock {
  kind: 'pdf';
  id: string;
  /** base64 data URL: `data:application/pdf;base64,...` */
  dataUrl: string;
  /** Original file name for display ("blood-results.pdf") */
  filename: string;
  /** Bytes (post-base64) — surfaced in the UI list so the user can spot oversize uploads. */
  sizeBytes: number;
  sourceLabel: PdfSource;
  addedAt: number;
}

export type CaptureBlock = ImageBlock | TextBlock | PdfBlock;

/**
 * Image-kind blocks above this cap are rejected. A real ward round rarely
 * needs more than 3-4 photos; the cap is a safety net against runaway
 * gallery picks blowing up the extract call.
 */
export const IMAGE_HARD_CAP = 20;

/**
 * Text-kind blocks above this cap are rejected. Multi-page paste is rare;
 * 8 is a sane upper bound that doesn't constrain real-world flows.
 */
export const TEXT_HARD_CAP = 8;

/**
 * PDF-kind blocks above this cap are rejected. PDFs cost more tokens
 * per page than images, so the cap is tighter. 5 should cover a typical
 * "lab results PDF + discharge letter PDF + ECG PDF" round.
 */
export const PDF_HARD_CAP = 5;

/** Per-PDF size cap. The Toranot proxy MAX_BODY_BYTES is 5MB total request. */
export const PDF_MAX_BYTES = 5_000_000;

/**
 * Thrown by `addImageBlock` / `addTextBlock` when the per-kind cap is hit.
 * We throw rather than returning null because silent drops are exactly the
 * UX failure caps exist to prevent — every caller should either pre-check
 * counts or wrap in try/catch and surface a warning to the user.
 */
export class CapExceededError extends Error {
  constructor(
    public readonly kind: 'image' | 'text' | 'pdf',
    public readonly cap: number,
  ) {
    super(`capture cap exceeded for ${kind} blocks (${cap})`);
    this.name = 'CapExceededError';
  }
}

/** Backcompat shape for callers that haven't migrated to blocks yet. */
export interface Shot {
  id: string;
  blobUrl: string;
  dataUrl: string;
  capturedAt: number;
}

let blocks: CaptureBlock[] = [];

function countImages(): number {
  let n = 0;
  for (const b of blocks) if (b.kind === 'image') n++;
  return n;
}

function countTexts(): number {
  let n = 0;
  for (const b of blocks) if (b.kind === 'text') n++;
  return n;
}

function countPdfs(): number {
  let n = 0;
  for (const b of blocks) if (b.kind === 'pdf') n++;
  return n;
}

export function addImageBlock(dataUrl: string, source: ImageSource): ImageBlock {
  if (countImages() >= IMAGE_HARD_CAP) throw new CapExceededError('image', IMAGE_HARD_CAP);
  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);
  const block: ImageBlock = {
    kind: 'image',
    id: crypto.randomUUID(),
    dataUrl,
    blobUrl,
    sourceLabel: source,
    addedAt: Date.now(),
  };
  blocks.push(block);
  return block;
}

export function addTextBlock(content: string, source: TextSource): TextBlock {
  if (countTexts() >= TEXT_HARD_CAP) throw new CapExceededError('text', TEXT_HARD_CAP);
  const block: TextBlock = {
    kind: 'text',
    id: crypto.randomUUID(),
    content,
    sourceLabel: source,
    addedAt: Date.now(),
  };
  blocks.push(block);
  return block;
}

export function addPdfBlock(dataUrl: string, filename: string, sizeBytes: number, source: PdfSource = 'gallery'): PdfBlock {
  if (countPdfs() >= PDF_HARD_CAP) throw new CapExceededError('pdf', PDF_HARD_CAP);
  const block: PdfBlock = {
    kind: 'pdf',
    id: crypto.randomUUID(),
    dataUrl,
    filename,
    sizeBytes,
    sourceLabel: source,
    addedAt: Date.now(),
  };
  blocks.push(block);
  return block;
}

export function updateTextBlock(id: string, content: string): void {
  const idx = blocks.findIndex((b) => b.id === id && b.kind === 'text');
  if (idx === -1) return;
  const existing = blocks[idx] as TextBlock;
  blocks[idx] = { ...existing, content };
}

export function removeBlock(id: string): void {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx === -1) return;
  const [removed] = blocks.splice(idx, 1);
  if (removed && removed.kind === 'image') URL.revokeObjectURL(removed.blobUrl);
}

export function reorderBlocks(fromIndex: number, toIndex: number): void {
  if (fromIndex < 0 || fromIndex >= blocks.length) return;
  if (toIndex < 0 || toIndex >= blocks.length) return;
  if (fromIndex === toIndex) return;
  const [moved] = blocks.splice(fromIndex, 1);
  if (!moved) return;
  blocks.splice(toIndex, 0, moved);
}

export function listBlocks(): readonly CaptureBlock[] {
  return blocks;
}

export function clearBlocks(): void {
  for (const b of blocks) if (b.kind === 'image') URL.revokeObjectURL(b.blobUrl);
  blocks = [];
}

/**
 * @deprecated Use `listBlocks()` and filter by `kind === 'image'`. Kept for
 * straggler callers (tests, etc.) that haven't been migrated.
 */
export function listShots(): readonly Shot[] {
  return blocks
    .filter((b): b is ImageBlock => b.kind === 'image')
    .map((b) => ({ id: b.id, blobUrl: b.blobUrl, dataUrl: b.dataUrl, capturedAt: b.addedAt }));
}

/**
 * @deprecated Use `listBlocks()` and read text blocks directly. Returns the
 * first text block's content (concatenation would lose ordering metadata).
 */
export function getPastedText(): string | null {
  const t = blocks.find((b): b is TextBlock => b.kind === 'text');
  return t ? t.content : null;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data = ''] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(meta ?? '')?.[1] ?? 'image/png';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
