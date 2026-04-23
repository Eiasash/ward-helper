/**
 * In-memory multi-shot session state. Shots are held as data URLs (for agent
 * upload) + blob URLs (for UI preview). Nothing is persisted. clearShots()
 * revokes all blob URLs so memory is released.
 */

export interface Shot {
  id: string;
  blobUrl: string;
  dataUrl: string;
  capturedAt: number;
}

let shots: Shot[] = [];
let pastedText: string | null = null;

export function addShot(dataUrl: string): Shot {
  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);
  const shot: Shot = {
    id: crypto.randomUUID(),
    blobUrl,
    dataUrl,
    capturedAt: Date.now(),
  };
  shots.push(shot);
  return shot;
}

export function listShots(): readonly Shot[] {
  return shots;
}

export function removeShot(id: string): void {
  const idx = shots.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const [s] = shots.splice(idx, 1);
  if (s) URL.revokeObjectURL(s.blobUrl);
}

export function clearShots(): void {
  for (const s of shots) URL.revokeObjectURL(s.blobUrl);
  shots = [];
  pastedText = null;
}

export function setPastedText(t: string | null): void {
  pastedText = t;
}

export function getPastedText(): string | null {
  return pastedText;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data = ''] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(meta ?? '')?.[1] ?? 'image/png';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
