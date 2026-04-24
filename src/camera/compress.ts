/**
 * Downsize large images to a reasonable upload size.
 *
 * Primary workflow: phone photos of a desktop AZMA/Chameleon monitor —
 * NOT clean screenshots. Those are ~3-5 MB JPEG at native phone resolution
 * (4080x3072 on Oppo Find X9 Pro). Three of them at full res = an
 * 12-18 MB upload, which mobile Chrome silently chokes on when the page
 * is backgrounded mid-upload.
 *
 * Strategy: resize longest edge to 1600px, re-encode as JPEG quality 0.85.
 * On a phone photo of a monitor the extra 400px (vs 1200) and the extra
 * 10% quality (vs 0.75) meaningfully improve OCR on ID numbers and lab
 * values — the thing that matters most. A 4080x3072 phone JPEG becomes
 * ~400-700 kB — still small enough for mobile Chrome + Anthropic direct
 * path, big enough that the model can read smeared digits.
 *
 * Rule of thumb: for phone-of-monitor, every 200px of longest edge and
 * every 0.05 of JPEG quality is worth keeping. We only downsize at all
 * because uploading full-res JPEGs breaks on mobile Chrome when the
 * screen sleeps during upload.
 */

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;

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
