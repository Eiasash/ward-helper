import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openMailCompose, openShareSheet } from '@/notes/share';

describe('openMailCompose', () => {
  let originalHref: string;

  beforeEach(() => {
    originalHref = window.location.href;
    // window.location is tricky to stub in happy-dom; replace the whole object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: originalHref },
    });
  });

  it('builds a mailto URL with encoded to/subject/body', () => {
    openMailCompose({ to: 'doc@szmc.org.il', subject: 'קבלה', body: 'גוף קצר' });
    const href = (window.location as unknown as { href: string }).href;
    expect(href).toMatch(/^mailto:/);
    expect(href).toContain(encodeURIComponent('doc@szmc.org.il'));
    // URLSearchParams uses + for spaces; decodeURIComponent wouldn't reverse
    // that, so we check for the subject + body substrings after manual decoding.
    const qs = href.slice(href.indexOf('?') + 1);
    const params = new URLSearchParams(qs);
    expect(params.get('subject')).toBe('קבלה');
    expect(params.get('body')).toBe('גוף קצר');
  });

  it('truncates body over 6000 chars with a Hebrew marker', () => {
    const long = 'a'.repeat(8000);
    openMailCompose({ to: 'a@b.co', subject: 's', body: long });
    const href = (window.location as unknown as { href: string }).href;
    const qs = href.slice(href.indexOf('?') + 1);
    const body = new URLSearchParams(qs).get('body')!;
    expect(body.length).toBeLessThan(long.length);
    expect(body).toMatch(/קוצץ/);
    expect(body).toMatch(/פתח באפליקציה/);
  });

  it('leaves a short body untouched', () => {
    const body = 'קצר מאוד';
    openMailCompose({ to: 'a@b.co', subject: 's', body });
    const href = (window.location as unknown as { href: string }).href;
    const qs = href.slice(href.indexOf('?') + 1);
    expect(new URLSearchParams(qs).get('body')).toBe(body);
  });
});

describe('openShareSheet', () => {
  const originalDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share');

  afterEach(() => {
    if (originalDesc) {
      Object.defineProperty(Navigator.prototype, 'share', originalDesc);
    } else {
      delete (navigator as unknown as { share?: unknown }).share;
    }
  });

  it('returns false when navigator.share is undefined', async () => {
    // Remove any existing share property.
    delete (navigator as unknown as { share?: unknown }).share;
    expect('share' in navigator).toBe(false);
    const ok = await openShareSheet({ title: 't', text: 'x' });
    expect(ok).toBe(false);
  });

  it('returns true on successful share', async () => {
    const shareFn = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareFn,
    });
    const ok = await openShareSheet({ title: 'קבלה', text: 'גוף' });
    expect(ok).toBe(true);
    expect(shareFn).toHaveBeenCalledWith({ title: 'קבלה', text: 'גוף' });
  });

  it('returns true when the user dismisses (AbortError)', async () => {
    const abort = Object.assign(new Error('user dismissed'), { name: 'AbortError' });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        throw abort;
      }),
    });
    const ok = await openShareSheet({ title: 't', text: 'x' });
    expect(ok).toBe(true);
  });

  it('returns false on a real share failure', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('permission denied');
      }),
    });
    const ok = await openShareSheet({ title: 't', text: 'x' });
    expect(ok).toBe(false);
  });
});
