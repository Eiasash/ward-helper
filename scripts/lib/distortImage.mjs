/**
 * distortImage(srcPngBuffer, browser, opts) — apply realistic mobile-camera
 * degradation: rotation 0-15°, JPEG quality 30-60, brightness/contrast jitter,
 * optional crop. Returns a JPEG Buffer.
 *
 * Implementation: render the source PNG into a canvas via Playwright's
 * chromium (we already have Playwright, no Sharp / GraphicsMagick deps),
 * apply transforms, export with toDataURL('image/jpeg', q).
 *
 * Why JPEG out: real ward-photo uploads from phones are JPEGs with
 * compression artifacts. The bot should hit the same code path.
 */

export async function distortImage(srcPngBuffer, browser, opts = {}) {
  const {
    rotateDeg = 6 + Math.random() * 9,
    jpegQuality = 0.35 + Math.random() * 0.25,
    brightnessPct = 100 + (Math.random() - 0.5) * 14,
    contrastPct = 100 + (Math.random() - 0.5) * 12,
    cropPct = Math.random() * 0.04,
  } = opts;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 2200 } });
  const page = await ctx.newPage();

  // Embed the source PNG as a data URL inside the page; let canvas handle
  // the rest. This avoids any cross-process image transfer overhead.
  const dataUrl = `data:image/png;base64,${srcPngBuffer.toString('base64')}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#000">
<canvas id="c"></canvas>
<script>
window.__distortReady = false;
window.__distortError = null;
(async () => {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = ${JSON.stringify(dataUrl)};
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load')); });

    const W = img.naturalWidth, H = img.naturalHeight;
    const cropPx = Math.floor(Math.min(W, H) * ${cropPct});
    const cropW = W - 2 * cropPx;
    const cropH = H - 2 * cropPx;
    // Allow rotation overflow by enlarging the canvas.
    const angle = ${rotateDeg} * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const outW = Math.ceil(cropW * cos + cropH * sin);
    const outH = Math.ceil(cropW * sin + cropH * cos);

    const cv = document.getElementById('c');
    cv.width = outW;
    cv.height = outH;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, outW, outH);
    cx.filter = 'brightness(${brightnessPct}%) contrast(${contrastPct}%)';
    cx.translate(outW / 2, outH / 2);
    cx.rotate(angle);
    cx.drawImage(img, cropPx, cropPx, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
    // Add a subtle motion-blur smear (cheap fake): re-draw 3 offset copies.
    cx.globalAlpha = 0.18;
    cx.drawImage(img, cropPx, cropPx, cropW, cropH, -cropW / 2 + 2, -cropH / 2, cropW, cropH);
    cx.drawImage(img, cropPx, cropPx, cropW, cropH, -cropW / 2 - 2, -cropH / 2, cropW, cropH);
    cx.globalAlpha = 1.0;

    window.__distortDataUrl = cv.toDataURL('image/jpeg', ${jpegQuality});
    window.__distortReady = true;
  } catch (err) {
    window.__distortError = err.message;
    window.__distortReady = true;
  }
})();
</script>
</body></html>`;
  await page.setContent(html);
  await page.waitForFunction(() => window.__distortReady === true, { timeout: 15000 });
  const err = await page.evaluate(() => window.__distortError);
  if (err) {
    await ctx.close();
    throw new Error(`distortImage: canvas failure — ${err}`);
  }
  const dataUrl2 = await page.evaluate(() => window.__distortDataUrl);
  await ctx.close();
  // Strip data:image/jpeg;base64, prefix and return raw buffer.
  const base64 = dataUrl2.split(',')[1];
  return Buffer.from(base64, 'base64');
}
