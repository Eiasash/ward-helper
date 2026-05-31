import { beforeAll, describe, it, expect, vi } from 'vitest';
import { scrubPhi, installErrorConsole, type ErrEntry } from '@/debug/console';

// Self-init is skipped under NODE_ENV=test, so we control the "native" console.error
// (lets us assert passthrough) and install explicitly.
const nativeErr = vi.fn();

declare global {
  interface Window {
    __debug?: { show: () => void; report: () => string; buffer: ErrEntry[]; clear: () => void };
  }
}

beforeAll(() => {
  console.error = nativeErr as unknown as typeof console.error;
  installErrorConsole();
});

describe('scrubPhi — PHI redaction', () => {
  it('redacts digit runs >= 4 (teudat-zehut / MRN / phone / dates / big labs)', () => {
    expect(scrubPhi('id 312345678')).toBe('id [#]');
    expect(scrubPhi('phone 0501234567')).toBe('phone [#]');
    expect(scrubPhi('date 20260531')).toBe('date [#]');
  });

  it('keeps short numbers (<4 digits) — not identifying on their own', () => {
    expect(scrubPhi('age 84 glucose 250 BP 120')).toBe('age 84 glucose 250 BP 120');
  });

  it('redacts quoted input echoes', () => {
    expect(scrubPhi('parse failed near "chest pain ongoing"')).toBe('parse failed near "[redacted]"');
    expect(scrubPhi("near 'abc'")).toBe("near '[redacted]'");
  });

  it('redacts any Hebrew run (names / clinical prose)', () => {
    const out = scrubPhi('המטופל כהן עם כאב חזה');
    expect(out).not.toMatch(/[֐-׿]/);
    expect(out).toContain('[he]');
  });

  it('keeps English error text readable', () => {
    expect(scrubPhi('TypeError: d.setAttribute is not a function')).toBe(
      'TypeError: d.setAttribute is not a function',
    );
  });

  it('combined realistic PHI line: no digit>=4 leak, no Hebrew leak', () => {
    const out = scrubPhi('מטופל כהן ת.ז. 312345678 בן 84, "כאב חזה מתמשך"');
    expect(out).not.toMatch(/\d{4,}/);
    expect(out).not.toMatch(/[֐-׿]/);
  });

  it('handles null / undefined / non-string input', () => {
    expect(scrubPhi(null)).toBe('');
    expect(scrubPhi(undefined)).toBe('');
    expect(scrubPhi(312345678)).toBe('[#]');
  });
});

describe('error console — capture + report', () => {
  it('exposes window.__debug after install', () => {
    expect(window.__debug).toBeTruthy();
    expect(typeof window.__debug!.report).toBe('function');
  });

  it('captures console.error AND passes through to native (passthrough)', () => {
    window.__debug!.clear();
    nativeErr.mockClear();
    console.error('boom', new Error('explode'));
    expect(nativeErr).toHaveBeenCalledTimes(1); // passthrough preserved
    expect(window.__debug!.report()).toContain('console.error');
  });

  it('captures uncaught window errors — message scrubbed, stack header (PHI echo) dropped', () => {
    window.__debug!.clear();
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Cannot read x of 312345678',
        error: new Error('Cannot read x of 312345678'),
      }),
    );
    const entry = window.__debug!.buffer[0]!;
    expect(entry.message).toContain('[#]');
    expect(entry.message).not.toContain('312345678');
    // the "Error: <raw message>" stack header must be stripped — no raw PHI in the stack either
    expect(entry.stack).not.toContain('312345678');
  });

  it('captures unhandled promise rejections — no Hebrew / id leak in message or stack', () => {
    window.__debug!.clear();
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('failed for חולה 99999');
    window.dispatchEvent(ev);
    const entry = window.__debug!.buffer[0]!;
    expect(entry.type).toBe('promise');
    expect(entry.message).not.toMatch(/\d{4,}/); // 99999 scrubbed from message
    expect(entry.message).not.toMatch(/[֐-׿]/); // Hebrew scrubbed from message
    expect(entry.stack).not.toMatch(/[֐-׿]/); // header dropped → no Hebrew in stack
    // frame line numbers may be >=4 digits (legit, not PHI) so we don't assert \d{4,} on the stack
    expect(window.__debug!.report()).not.toMatch(/[֐-׿]/); // no Hebrew anywhere in the report
  });

  it('report shows the PHI-scrubbed banner', () => {
    expect(window.__debug!.report()).toContain('PHI-scrubbed — review before sharing');
  });

  it('ring buffer caps at 50', () => {
    window.__debug!.clear();
    for (let i = 0; i < 60; i++) console.error('e' + i);
    expect(window.__debug!.buffer.length).toBe(50);
  });
});
