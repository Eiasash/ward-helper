/**
 * Extract payload wire-budget guard (fix for "proxy HTTP 413 / phase=extract",
 * reported 2026-05-28 from an iPhone fresh-guest round).
 *
 * The Toranot proxy rejects request bodies over ~5 MB. The per-image and
 * per-PDF caps are each individually satisfiable while their SUM exceeds the
 * ceiling, so runExtractTurn must fail fast with an actionable Hebrew message
 * BEFORE the network call — never let the bare 413 surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runExtractTurn, estimateExtractWireBytes } from '@/agent/loop';
import type { CaptureBlock } from '@/camera/session';

function mockOk(text: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

function img(base64: string): CaptureBlock {
  return {
    kind: 'image',
    id: 'i-' + Math.random(),
    dataUrl: 'data:image/jpeg;base64,' + base64,
    blobUrl: 'blob:fake',
    sourceLabel: 'camera',
    addedAt: 0,
  };
}
function pdf(base64: string): CaptureBlock {
  return {
    kind: 'pdf',
    id: 'p-' + Math.random(),
    dataUrl: 'data:application/pdf;base64,' + base64,
    filename: 'labs.pdf',
    sizeBytes: base64.length,
    sourceLabel: 'gallery',
    addedAt: 0,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear(); // ensure guest/proxy state by default
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('estimateExtractWireBytes', () => {
  it('counts base64 payload of image/pdf blocks plus skill + prompt text', () => {
    const small = estimateExtractWireBytes([img('A'.repeat(1000))], '');
    const big = estimateExtractWireBytes([img('A'.repeat(2000))], '');
    // The 1000-char delta in base64 must show up roughly 1:1 in the estimate.
    expect(big - small).toBeGreaterThanOrEqual(1000);
  });

  it('includes the skill system prompt in the budget', () => {
    const withSkill = estimateExtractWireBytes([img('A'.repeat(10))], 'X'.repeat(5000));
    const withoutSkill = estimateExtractWireBytes([img('A'.repeat(10))], '');
    expect(withSkill - withoutSkill).toBeGreaterThanOrEqual(5000);
  });

  it('counts Hebrew text in UTF-8 bytes (~2 B/char), not JS string length', () => {
    // 1000 Hebrew chars = ~2000 UTF-8 bytes. Char-length accounting would
    // under-count by half and let an oversize Hebrew paste through.
    const hebrew = 'א'.repeat(1000);
    const base = estimateExtractWireBytes([], '');
    const withHebrew = estimateExtractWireBytes(
      [{ kind: 'text', id: 't', content: hebrew, sourceLabel: 'paste', addedAt: 0 }],
      '',
    );
    expect(withHebrew - base).toBeGreaterThanOrEqual(2000);
  });

  it('a large Hebrew paste under char-budget but over BYTE-budget is caught', async () => {
    vi.stubGlobal('fetch', mockOk('{}'));
    // 2.5M Hebrew chars: string length 2.5M (< 4.7M, old code would pass) but
    // ~5M UTF-8 bytes (> budget) — the real "413 still surfaces" gap Codex flagged.
    const blocks: CaptureBlock[] = [
      { kind: 'text', id: 't', content: 'א'.repeat(2_500_000), sourceLabel: 'paste', addedAt: 0 },
    ];
    expect(estimateExtractWireBytes(blocks, '')).toBeGreaterThan(4_700_000);
    await expect(runExtractTurn(blocks, 'skill')).rejects.toThrow(/גדולה מדי/);
  });
});

describe('runExtractTurn — wire-budget guard', () => {
  it('throws an actionable Hebrew message and does NOT hit the network when over budget', async () => {
    const fetchFn = mockOk('{}');
    vi.stubGlobal('fetch', fetchFn);

    // ~4.8 MB of base64 → over the 4.7 MB client budget.
    const blocks: CaptureBlock[] = [img('A'.repeat(4_800_000))];

    await expect(runExtractTurn(blocks, 'skill')).rejects.toThrow(/גדולה מדי/);
    // Fail-fast: the proxy must never be called, so no bare 413 can surface.
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('PDF-present over-budget gives PDF-specific advice', async () => {
    vi.stubGlobal('fetch', mockOk('{}'));
    const blocks: CaptureBlock[] = [pdf('A'.repeat(4_800_000))];
    await expect(runExtractTurn(blocks, 'skill')).rejects.toThrow(/PDF/);
  });

  it('proceeds to the network when the payload is comfortably under budget', async () => {
    const fetchFn = mockOk(JSON.stringify({ fields: {}, confidence: {} }));
    vi.stubGlobal('fetch', fetchFn);

    const blocks: CaptureBlock[] = [img('A'.repeat(2000))];
    await runExtractTurn(blocks, 'skill');

    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('does NOT guard the BYOK direct path — Anthropic accepts larger bodies (Codex PR#226)', async () => {
    // Seed a real logged-in user + personal key so activeAiPath() resolves to
    // 'direct' naturally (getCurrentUser() truthy + wardhelper_apikey set) and
    // callClaude() actually takes the direct path — a faithful BYOK state, not
    // a mocked-only one. The request goes direct to api.anthropic.com, which
    // has no 5MB proxy ceiling, so an oversize payload must NOT be blocked.
    localStorage.setItem(
      'ward-helper.auth.user',
      JSON.stringify({ username: 'docnight', displayName: null, loggedInAt: Date.now() }),
    );
    localStorage.setItem('wardhelper_apikey', 'sk-ant-test-key');
    const fetchFn = mockOk(JSON.stringify({ fields: {}, confidence: {} }));
    vi.stubGlobal('fetch', fetchFn);

    const blocks: CaptureBlock[] = [img('A'.repeat(4_800_000))]; // > proxy budget
    await runExtractTurn(blocks, 'skill');

    // Guard skipped → request proceeded to the network exactly once.
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('a typical 6-photo round (~700kB each) stays under budget', async () => {
    // 6 compressed phone photos ≈ 6 × 700 kB = 4.2 MB < 4.7 MB → should pass.
    const blocks: CaptureBlock[] = Array.from({ length: 6 }, () =>
      img('A'.repeat(700_000)),
    );
    expect(estimateExtractWireBytes(blocks, '')).toBeLessThan(4_700_000);
  });

  it('an 8-photo round (~700kB each) exceeds budget and is caught', async () => {
    // 8 × 700 kB = 5.6 MB > ceiling — the real failure shape.
    const blocks: CaptureBlock[] = Array.from({ length: 8 }, () =>
      img('A'.repeat(700_000)),
    );
    expect(estimateExtractWireBytes(blocks, '')).toBeGreaterThan(4_700_000);
  });
});
