import { describe, it, expect, beforeEach } from 'vitest';
import {
  clip,
  snapshot,
  clear,
  recordExtract,
  recordEmit,
  recordError,
} from '@/agent/debugLog';

describe('debugLog — clip', () => {
  it('returns unchanged when under the limit', () => {
    const s = 'x'.repeat(3000);
    expect(clip(s)).toBe(s);
  });

  it('returns unchanged at exactly the limit (4096)', () => {
    const s = 'x'.repeat(4096);
    expect(clip(s)).toBe(s);
  });

  it('clips at 10KB and preserves head + tail + elision marker', () => {
    const body = Array.from({ length: 10000 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
    const clipped = clip(body);
    expect(clipped.length).toBeLessThanOrEqual(4096 + 50);
    expect(clipped).toContain('bytes elided');
    expect(clipped.startsWith(body.slice(0, 100))).toBe(true);
    expect(clipped.endsWith(body.slice(-100))).toBe(true);
  });
});

describe('debugLog — snapshot / record / clear', () => {
  beforeEach(() => {
    clear();
  });

  it('snapshot() initially returns {extract:null, emit:null, error:null}', () => {
    expect(snapshot()).toEqual({ extract: null, emit: null, error: null });
  });

  it('recordExtract + snapshot returns entry with body, meta, ts', () => {
    recordExtract('{"foo":"bar"}', { images: 2, in_tokens: 100, out_tokens: 50, ms: 1234 });
    const s = snapshot();
    expect(s.extract).not.toBeNull();
    expect(s.extract!.body).toBe('{"foo":"bar"}');
    expect(s.extract!.meta).toEqual({ images: 2, in_tokens: 100, out_tokens: 50, ms: 1234 });
    expect(typeof s.extract!.ts).toBe('number');
    expect(s.extract!.ts).toBeGreaterThan(0);
  });

  it('recordEmit stores the emit bucket independently', () => {
    recordEmit('some note body', { noteType: 'admission' });
    const s = snapshot();
    expect(s.emit?.body).toBe('some note body');
    expect(s.emit?.meta).toEqual({ noteType: 'admission' });
    expect(s.extract).toBeNull();
  });

  it('recordError accepts an Error instance', () => {
    recordError(new Error('boom'), { phase: 'extract' });
    expect(snapshot().error?.body).toBe('boom');
    expect(snapshot().error?.meta).toEqual({ phase: 'extract' });
  });

  it('recordError accepts a string', () => {
    recordError('string error');
    expect(snapshot().error?.body).toBe('string error');
  });

  it('recordError accepts unknown (falls back to String())', () => {
    recordError({ weird: 'object' });
    expect(snapshot().error?.body).toBe('[object Object]');
    recordError(42);
    expect(snapshot().error?.body).toBe('42');
  });

  it('clear() zeros all three buckets', () => {
    recordExtract('a');
    recordEmit('b');
    recordError('c');
    expect(snapshot().extract).not.toBeNull();
    expect(snapshot().emit).not.toBeNull();
    expect(snapshot().error).not.toBeNull();
    clear();
    expect(snapshot()).toEqual({ extract: null, emit: null, error: null });
  });

  it('ring behavior: latest record replaces previous in the same bucket', () => {
    recordExtract('first');
    recordExtract('second');
    expect(snapshot().extract?.body).toBe('second');
  });
});
