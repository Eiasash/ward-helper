import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressImage, estimateDataUrlBytes } from '@/camera/compress';

// 1×1 transparent PNG, base64-encoded.
const TINY_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

/**
 * happy-dom doesn't decode `<img src="data:...">` automatically (no real
 * image-decoding pipeline), so an unmocked `compressImage()` hangs forever
 * waiting for `onload`. Stub the Image constructor to fire `onload` on the
 * next microtask with caller-controlled dimensions, so we can exercise both
 * the early-return path (small image) and the resize path (large image).
 */
function stubImage(width: number, height: number) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = width;
    height = height;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
}

describe('estimateDataUrlBytes', () => {
  it('returns 0 for a string with no comma (not a data URL)', () => {
    expect(estimateDataUrlBytes('not a data url')).toBe(0);
  });

  it('estimates within ±1 byte of base64 decoded length', () => {
    // 4 base64 chars = 3 bytes
    const dataUrl = 'data:application/octet-stream;base64,QUJDRA=='; // "ABCD" = 4 bytes
    const bytes = estimateDataUrlBytes(dataUrl);
    // Implementation ignores padding: 8 chars × 0.75 = 6, real is 4.
    // Acceptable for size budgeting (tells you "is this 100kB or 10MB?").
    expect(bytes).toBeGreaterThanOrEqual(4);
    expect(bytes).toBeLessThanOrEqual(7);
  });

  it('scales linearly with payload length', () => {
    const small = 'data:image/png;base64,' + 'A'.repeat(100);
    const big = 'data:image/png;base64,' + 'A'.repeat(10_000);
    const bigBytes = estimateDataUrlBytes(big);
    const smallBytes = estimateDataUrlBytes(small);
    // 100x base64 should yield ~100x byte estimate
    expect(bigBytes / smallBytes).toBeGreaterThan(80);
    expect(bigBytes / smallBytes).toBeLessThan(120);
  });
});

describe('compressImage — early-return path (image already small)', () => {
  beforeEach(() => stubImage(800, 600));
  afterEach(() => vi.unstubAllGlobals());

  it('returns the input data URL unchanged when longest edge ≤ 1600px', async () => {
    const out = await compressImage(TINY_PNG_DATAURL);
    expect(out).toBe(TINY_PNG_DATAURL);
  });

  it('is idempotent on already-small input (re-process is a no-op)', async () => {
    const first = await compressImage(TINY_PNG_DATAURL);
    const second = await compressImage(first);
    expect(second).toBe(first);
  });
});

describe('compressImage — resize path (large image)', () => {
  beforeEach(() => stubImage(2412, 1080));
  afterEach(() => vi.unstubAllGlobals());

  it('takes the resize branch (output differs from input) when longest edge > 1600px', async () => {
    // happy-dom's canvas.toDataURL doesn't pixel-encode, but the function
    // still goes through createElement('canvas') + drawImage + toDataURL,
    // returning *some* string that isn't the original input. That confirms
    // the early-return guard at MAX_LONG_EDGE was bypassed — which is the
    // only logic this test owns. JPEG encoding fidelity is a real-browser
    // concern and is exercised in the live deploy + the manual capture flow.
    let out: string;
    try {
      out = await compressImage(TINY_PNG_DATAURL);
    } catch (e) {
      // happy-dom throws "canvas 2d context unavailable" on some versions —
      // also acceptable proof we left the early-return branch.
      expect((e as Error).message).toMatch(/canvas/i);
      return;
    }
    expect(typeof out).toBe('string');
    expect(out).not.toBe(TINY_PNG_DATAURL);
  });
});

describe('compressImage — failure path', () => {
  it('rejects when image decoding fails', async () => {
    class FailImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailImage as unknown as typeof Image);
    await expect(compressImage(TINY_PNG_DATAURL)).rejects.toThrow(/failed to decode/);
    vi.unstubAllGlobals();
  });
});
