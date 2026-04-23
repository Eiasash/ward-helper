/**
 * Downsize large images to a reasonable upload size.
 *
 * AZMA screenshots at native phone resolution (e.g. 2412 x 1080 on Oppo
 * Find X9 Pro) are ~2-3 MB PNG each. Three of them at full res = a
 * 6-12 MB upload, which mobile Chrome silently chokes on when the page
 * is backgrounded mid-upload.
 *
 * Strategy: resize longest edge to 1600px (plenty for OCR on AZMA text,
 * which is large and high-contrast), re-encode as JPEG quality 0.85.
 * A 2412 x 1080 PNG becomes ~300-500 kB JPEG — a 20x reduction in
 * upload size, with no OCR quality loss for this use case.
 */

const MAX_LONG_EDGE = 1200;
const JPEG_QUALITY = 0.75;

export async function compressImage(dataUrl: string): Promise<string> {
  // Parse the data URL to a bitmap.
  const img = await loadImage(dataUrl);
  const { width: w0, height: h0 } = img;

  // If already small enough, return as-is.
  if (Math.max(w0, h0) <= MAX_LONG_EDGE) {
    return dataUrl;
  }

  const scale = MAX_LONG_EDGE / Math.max(w0, h0);
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to decode image'));
    img.src = src;
  });
}

/** Rough byte size of a base64-encoded data URL payload (minus the mime header). */
export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  // base64 expands bytes by 4/3; inverse is 3/4. Ignore padding nuance.
  return Math.round(b64.length * 0.75);
}
